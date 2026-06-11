import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve, relative, sep } from 'path'
import { spawn } from 'child_process'
import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/sqlite-client'
import { runPlaywrightScreenshots, type PlaywrightShot } from './playwright-runner'
import { WORKSPACE_ALLOWED_ROOTS } from '@kosmos/shared'

export interface FrontendReviewResult {
  executed: boolean
  reason?: string
  script?: string
  command?: string
  base_url?: string
  screenshots: Array<{ path: string; url: string; viewport: 'desktop' | 'mobile' }>
  logs: string[]
}

interface FrontendScriptMatch {
  cwd: string
  script: string
  command: string
}

interface ParsedPackageJson {
  scripts?: Record<string, string>
}

function parseJsonFile(path: string): ParsedPackageJson | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { scripts?: unknown }
    const scripts = parsed && typeof parsed === 'object' && parsed.scripts && typeof parsed.scripts === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.scripts as Record<string, unknown>)
            .map(([key, value]) => [String(key), String(value || '')]),
        )
      : undefined
    return { scripts }
  } catch {
    return null
  }
}

function discoverFrontendScripts(workspacePath: string): FrontendScriptMatch[] {
  const candidates: FrontendScriptMatch[] = []
  const packagePaths = [
    join(workspacePath, 'package.json'),
    join(workspacePath, 'apps', 'frontend', 'package.json'),
  ]

  for (const packagePath of packagePaths) {
    const pkg = parseJsonFile(packagePath)
    if (!pkg?.scripts || typeof pkg.scripts !== 'object') continue
    const cwd = packagePath.replace(/\/package\.json$/, '')
    for (const [name, command] of Object.entries(pkg.scripts)) {
      const scriptName = String(name)
      const scriptCommand = String(command || '')
      const searchable = `${scriptName} ${scriptCommand}`.toLowerCase()
      const looksFrontend = /frontend|vite|next|react|web/.test(searchable)
      const looksDev = /dev|start|preview/.test(searchable)
      if (looksFrontend && looksDev) {
        candidates.push({ cwd, script: scriptName, command: scriptCommand })
      }
    }
  }

  return candidates
}

function inferPortFromCommand(command: string): number {
  const text = String(command || '')
  const direct = text.match(/--port\s+(\d{2,5})/i) || text.match(/-p\s+(\d{2,5})/i)
  if (direct?.[1]) return Number(direct[1])
  const env = text.match(/PORT=(\d{2,5})/i)
  if (env?.[1]) return Number(env[1])
  if (/next/i.test(text)) return 3000
  if (/vite/i.test(text)) return 5173
  return 5173
}

function normalizeReadyBaseUrl(url: string): string {
  const value = String(url || '').trim()
  const match = value.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\]|[a-z0-9.-]+):(\d{2,5})/i)
  if (!match?.[1]) return value
  const port = Number(match[1])
  if (port === 18793) {
    return 'http://127.0.0.1:18794'
  }
  return `http://127.0.0.1:${port}`
}

function looksLikePortInUse(line: string): boolean {
  const text = String(line || '').toLowerCase()
  return text.includes('port') && text.includes('in use')
}

function wait(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function stripAnsi(text: string): string {
  return String(text || '').split('').filter((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 || code === 9 || code === 10 || code === 13
  }).join('')
}

function extractHttpUrl(line: string): string | null {
  const cleanLine = stripAnsi(String(line || ''))
  const match = cleanLine.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[^\]]+\]|[a-z0-9.-]+):(\d{2,5})/i)
  if (!match?.[1]) return null
  return `http://127.0.0.1:${match[1]}`
}

async function waitForAnyHttpReady(urlsProvider: () => string[], timeoutMs = 45000): Promise<string | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const candidates = urlsProvider().filter(Boolean)
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate)
        if (response.ok || response.status < 500) {
          return candidate
        }
      } catch {
        // continue trying other urls
      }
    }
    await wait(1200)
  }
  return null
}

async function discoverCandidateUrls(baseUrl: string): Promise<string[]> {
  const discovered = new Set<string>([baseUrl])
  const shouldCaptureUrl = (candidate: string): boolean => {
    const value = String(candidate || '').trim()
    if (!value) return false
    if (!/^https?:\/\//i.test(value)) return false
    try {
      const parsed = new URL(value)
      const pathname = parsed.pathname || '/'
      if (pathname.startsWith('/@vite') || pathname.startsWith('/node_modules') || pathname.startsWith('/assets/')) {
        return false
      }
      const lastSegment = pathname.split('/').filter(Boolean).pop() || ''
      const extensionMatch = lastSegment.match(/\.([a-z0-9]{1,6})$/i)
      if (!extensionMatch) return true
      const extension = extensionMatch[1].toLowerCase()
      const blockedExtensions = new Set([
        'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico',
        'css', 'js', 'mjs', 'map', 'json', 'txt', 'woff', 'woff2', 'ttf', 'eot',
      ])
      return !blockedExtensions.has(extension)
    } catch {
      return false
    }
  }

  try {
    const response = await fetch(baseUrl)
    const html = await response.text()
    const hrefMatches = html.match(/href=["']([^"'#]+)["']/gi) || []
    for (const match of hrefMatches) {
      const raw = match.replace(/href=["']/i, '').replace(/["']$/i, '').trim()
      if (!raw) continue
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        if (raw.startsWith(baseUrl)) {
          if (shouldCaptureUrl(raw)) {
            discovered.add(raw)
          }
        }
        continue
      }
      if (raw.startsWith('/')) {
        const absolute = `${baseUrl.replace(/\/$/, '')}${raw}`
        if (shouldCaptureUrl(absolute)) {
          discovered.add(absolute)
        }
      }
    }
  } catch {
    // fallback to base URL only
  }
  return Array.from(discovered).slice(0, 8)
}

function sanitizeUrlList(baseUrl?: string, urls?: string[]): string[] {
  const normalized = new Set<string>()
  if (baseUrl) normalized.add(String(baseUrl).trim())
  if (Array.isArray(urls)) {
    for (const raw of urls) {
      const value = String(raw || '').trim()
      if (value) normalized.add(value)
    }
  }
  return Array.from(normalized).filter((value) => /^https?:\/\//i.test(value))
}

function ensurePathInsideWorkspace(workspacePath: string, candidatePath: string): string {
  const root = resolve(workspacePath)
  const allowed = WORKSPACE_ALLOWED_ROOTS.some((allowedRoot) =>
    root === allowedRoot || root.startsWith(allowedRoot + sep)
  )
  if (!allowed) {
    throw new Error('workspace_path is not in an allowed directory')
  }
  const candidate = resolve(root, candidatePath)
  const rel = relative(root, candidate)
  if (rel.startsWith('..')) {
    throw new Error('output_subdir must stay inside workspace path')
  }
  return candidate
}

function normalizeScreenshots(shots: PlaywrightShot[]): FrontendReviewResult['screenshots'] {
  return shots.map((shot) => ({
    path: shot.path,
    url: shot.url,
    viewport: shot.viewport,
  }))
}

async function persistQaEvidence(taskId: string, result: FrontendReviewResult & { persisted?: boolean; task_id?: string }) {
  const db = await getDb()
  const id = uuid()
  const createdAt = new Date().toISOString()
  const payload = JSON.stringify(result)
  db.run('BEGIN')
  try {
    db.run('INSERT INTO qa_evidence (id, task_id, payload, created_at) VALUES (?, ?, ?, ?)', [
      id,
      taskId,
      payload,
      createdAt,
    ])
    db.run('DELETE FROM qa_evidence WHERE id NOT IN (SELECT id FROM qa_evidence WHERE task_id = ? ORDER BY created_at DESC LIMIT 10)', [taskId])
    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }
  saveDb(db)
}

async function runDirectCapture(params: {
  workspacePath: string
  urls: string[]
  outputDir: string
  script?: string
  command?: string
  baseUrl?: string
}): Promise<FrontendReviewResult> {
  const run = await runPlaywrightScreenshots({
    workspacePath: params.workspacePath,
    outputDir: params.outputDir,
    urls: params.urls,
  })

  return {
    executed: run.ok,
    reason: run.reason,
    script: params.script,
    command: params.command,
    base_url: params.baseUrl || params.urls[0],
    screenshots: normalizeScreenshots(run.screenshots),
    logs: run.logs.slice(-60),
  }
}

async function runWithFrontendScript(params: {
  workspacePath: string
  selected: FrontendScriptMatch
  outputDir: string
  maxUrls?: number
}): Promise<FrontendReviewResult> {
  const inferredPort = inferPortFromCommand(params.selected.command)
  let detectedBaseUrl = `http://127.0.0.1:${inferredPort}`
  const fallbackBaseUrl = detectedBaseUrl
  const logs: string[] = []
  const discoveredUrls = new Set<string>([detectedBaseUrl])

  const devProc = spawn('npm', ['run', params.selected.script], {
    cwd: params.selected.cwd,
    env: { ...process.env, CI: '1' },
  })

  devProc.stdout?.on('data', (chunk) => {
    const line = chunk.toString().trim()
    if (!line) return
    logs.push(line)
    const url = extractHttpUrl(line)
    if (url) {
      detectedBaseUrl = url
      discoveredUrls.add(url)
    }
    if (looksLikePortInUse(line)) {
      discoveredUrls.add(fallbackBaseUrl)
    }
  })

  devProc.stderr?.on('data', (chunk) => {
    const line = chunk.toString().trim()
    if (!line) return
    logs.push(line)
    const url = extractHttpUrl(line)
    if (url) {
      detectedBaseUrl = url
      discoveredUrls.add(url)
    }
    if (looksLikePortInUse(line)) {
      discoveredUrls.add(fallbackBaseUrl)
    }
  })

  try {
    const readyUrl = await waitForAnyHttpReady(() => Array.from(discoveredUrls))
    if (!readyUrl) {
      return {
        executed: false,
        reason: `Frontend did not become ready at ${detectedBaseUrl || fallbackBaseUrl}`,
        script: params.selected.script,
        command: params.selected.command,
        base_url: detectedBaseUrl || fallbackBaseUrl,
        screenshots: [],
        logs: logs.slice(-40),
      }
    }

    const normalizedReadyUrl = normalizeReadyBaseUrl(readyUrl)
    const urls = await discoverCandidateUrls(normalizedReadyUrl)
    const run = await runPlaywrightScreenshots({
      workspacePath: params.workspacePath,
      outputDir: params.outputDir,
      urls,
      maxUrls: params.maxUrls,
    })

    return {
      executed: run.ok,
      reason: run.reason,
      script: params.selected.script,
      command: params.selected.command,
      base_url: normalizedReadyUrl,
      screenshots: normalizeScreenshots(run.screenshots),
      logs: [...logs, ...run.logs].filter(Boolean).slice(-80),
    }
  } finally {
    devProc.kill('SIGTERM')
  }
}

export async function runPlaywrightCapture(params: {
  workspacePath: string
  taskId?: string
  baseUrl?: string
  urls?: string[]
  script?: string
  outputSubdir?: string
  maxUrls?: number
}): Promise<FrontendReviewResult & { persisted: boolean; task_id?: string }> {
  const workspacePath = String(params.workspacePath || '').trim()
  const taskId = String(params.taskId || '').trim()
  const requestedScript = String(params.script || '').trim()

  if (!workspacePath || !existsSync(workspacePath)) {
    return {
      executed: false,
      reason: 'Workspace path is missing or not found',
      screenshots: [],
      logs: [],
      persisted: false,
      task_id: taskId || undefined,
    }
  }

  const folderSuffix = taskId || `adhoc-${Date.now()}`
  const outputSubdir = String(params.outputSubdir || '').trim()
  const safeOutputDir = ensurePathInsideWorkspace(
    workspacePath,
    outputSubdir
      ? outputSubdir
      : join('.battlestation', 'evidence', folderSuffix),
  )
  mkdirSync(safeOutputDir, { recursive: true })

  const directUrls = sanitizeUrlList(params.baseUrl, params.urls)
  let result: FrontendReviewResult

  if (directUrls.length > 0) {
    result = await runDirectCapture({
      workspacePath,
      urls: directUrls,
      outputDir: safeOutputDir,
      baseUrl: params.baseUrl,
    })
  } else {
    const scripts = discoverFrontendScripts(workspacePath)
    if (!scripts.length) {
      result = {
        executed: false,
        reason: 'No frontend dev/start scripts discovered and no base_url/urls provided',
        screenshots: [],
        logs: [],
      }
    } else {
      const selected = requestedScript
        ? scripts.find((item) => item.script === requestedScript)
        : scripts[0]

      if (!selected) {
        result = {
          executed: false,
          reason: `Requested script '${requestedScript}' was not found`,
          screenshots: [],
          logs: [],
        }
      } else {
        result = await runWithFrontendScript({
          workspacePath,
          selected,
          outputDir: safeOutputDir,
          maxUrls: params.maxUrls,
        })
      }
    }
  }

  const shouldPersist = Boolean(taskId)
  if (shouldPersist) {
    await persistQaEvidence(taskId, {
      ...result,
      persisted: true,
      task_id: taskId,
    })
  }

  return {
    ...result,
    persisted: shouldPersist,
    task_id: shouldPersist ? taskId : undefined,
  }
}

export async function runFrontendQaEvidence(params: {
  workspacePath: string
  taskId: string
}): Promise<FrontendReviewResult> {
  const result = await runPlaywrightCapture({
    workspacePath: params.workspacePath,
    taskId: params.taskId,
  })

  return {
    executed: result.executed,
    reason: result.reason,
    script: result.script,
    command: result.command,
    base_url: result.base_url,
    screenshots: result.screenshots,
    logs: result.logs,
  }
}
