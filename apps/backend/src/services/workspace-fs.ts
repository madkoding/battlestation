import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, normalize, relative, resolve, sep } from 'path'
import { WORKSPACE_ALLOWED_ROOTS } from '@kosmos/shared'

type WorkspaceListEntry = { path: string; type: 'file' | 'directory'; size?: number }
type WorkspaceSearchMatch = { path: string; line: number; text: string }

function ensureWorkspaceRoot(workspacePath: string): { ok: boolean; error?: string; root?: string } {
  const root = String(workspacePath || '').trim()
  if (!root) return { ok: false, error: 'workspace_path is required' }
  const resolved = resolve(root)
  if (!existsSync(resolved)) return { ok: false, error: 'workspace_path does not exist' }

  const allowed = WORKSPACE_ALLOWED_ROOTS.some((allowedRoot) =>
    resolved === allowedRoot || resolved.startsWith(allowedRoot + sep)
  )
  if (!allowed) {
    return { ok: false, error: 'workspace_path is not in an allowed directory' }
  }

  return { ok: true, root: resolved }
}

function resolveWithinWorkspace(root: string, target: string): { ok: boolean; error?: string; path?: string } {
  const candidate = normalize(String(target || '.')).replace(/^\/+/, '')
  const resolved = resolve(root, candidate)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    return { ok: false, error: 'path is outside workspace' }
  }
  return { ok: true, path: resolved }
}

function scanFiles(root: string, startPath: string, limit = 5000): string[] {
  const files: string[] = []
  const stack = [startPath]
  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop() as string
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        files.push(full)
        if (files.length >= limit) break
      }
    }
  }
  return files
}

function globToRegExp(pattern: string): RegExp {
  const escaped = String(pattern || '**/*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

export async function workspaceList(params: {
  workspacePath: string
  path?: string
  recursive?: boolean
  limit?: number
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error, entries: [] as WorkspaceListEntry[] }
  const root = rootCheck.root as string
  const resolvedCheck = resolveWithinWorkspace(root, String(params.path || '.'))
  if (!resolvedCheck.ok) return { ok: false, error: resolvedCheck.error, entries: [] as WorkspaceListEntry[] }
  const target = resolvedCheck.path as string
  if (!existsSync(target)) return { ok: false, error: 'path not found', entries: [] as WorkspaceListEntry[] }

  const recursive = Boolean(params.recursive)
  const limit = Math.max(1, Math.min(Number(params.limit || 200), 5000))
  const entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = []

  if (!recursive) {
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const full = join(target, entry.name)
      const rel = relative(root, full) || '.'
      const type = entry.isDirectory() ? 'directory' : 'file'
      const size = entry.isFile() ? statSync(full).size : undefined
      entries.push({ path: rel, type, size })
      if (entries.length >= limit) break
    }
    return { ok: true, entries }
  }

  for (const file of scanFiles(root, target, limit)) {
    entries.push({ path: relative(root, file), type: 'file', size: statSync(file).size })
    if (entries.length >= limit) break
  }
  return { ok: true, entries }
}

export async function workspaceRead(params: {
  workspacePath: string
  path: string
  offset?: number
  limit?: number
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error, content: '' }
  const root = rootCheck.root as string
  const resolvedCheck = resolveWithinWorkspace(root, String(params.path || ''))
  if (!resolvedCheck.ok) return { ok: false, error: resolvedCheck.error, content: '' }
  const filePath = resolvedCheck.path as string
  if (!existsSync(filePath)) return { ok: false, error: 'path not found', content: '' }
  if (!statSync(filePath).isFile()) return { ok: false, error: 'path is not a file', content: '' }

  const text = readFileSync(filePath, 'utf-8')
  const lines = text.split('\n')
  const start = Math.max(1, Number(params.offset || 1))
  const take = Math.max(1, Math.min(Number(params.limit || 400), 4000))
  const selected = lines.slice(start - 1, start - 1 + take)

  return {
    ok: true,
    path: relative(root, filePath),
    content: selected.join('\n'),
    start_line: start,
    total_lines: lines.length,
  }
}

export async function workspaceWrite(params: {
  workspacePath: string
  path: string
  content: string
  append?: boolean
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error }
  const root = rootCheck.root as string
  const resolvedCheck = resolveWithinWorkspace(root, String(params.path || ''))
  if (!resolvedCheck.ok) return { ok: false, error: resolvedCheck.error }
  const filePath = resolvedCheck.path as string
  mkdirSync(dirname(filePath), { recursive: true })
  const content = String(params.content || '')
  if (params.append && existsSync(filePath)) {
    const previous = readFileSync(filePath, 'utf-8')
    writeFileSync(filePath, `${previous}${content}`, 'utf-8')
  } else {
    writeFileSync(filePath, content, 'utf-8')
  }
  return { ok: true, path: relative(root, filePath) }
}

export async function workspaceEdit(params: {
  workspacePath: string
  path: string
  find: string
  replace: string
  all?: boolean
  regex?: boolean
  ignore_case?: boolean
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error, replacements: 0 }
  const root = rootCheck.root as string
  const resolvedCheck = resolveWithinWorkspace(root, String(params.path || ''))
  if (!resolvedCheck.ok) return { ok: false, error: resolvedCheck.error, replacements: 0 }
  const filePath = resolvedCheck.path as string
  if (!existsSync(filePath)) return { ok: false, error: 'path not found', replacements: 0 }
  if (!statSync(filePath).isFile()) return { ok: false, error: 'path is not a file', replacements: 0 }

  const source = readFileSync(filePath, 'utf-8')
  const find = String(params.find || '')
  const replace = String(params.replace || '')
  if (!find) return { ok: false, error: 'find is required', replacements: 0 }

  let updated = source
  let replacements = 0
  if (params.regex) {
    const flags = `${params.all ? 'g' : ''}${params.ignore_case ? 'i' : ''}`
    const regex = new RegExp(find, flags || undefined)
    updated = source.replace(regex, () => {
      replacements += 1
      return replace
    })
  } else if (params.all) {
    const parts = source.split(find)
    replacements = Math.max(0, parts.length - 1)
    updated = parts.join(replace)
  } else {
    const index = source.indexOf(find)
    if (index >= 0) {
      replacements = 1
      updated = `${source.slice(0, index)}${replace}${source.slice(index + find.length)}`
    }
  }

  if (replacements > 0) {
    writeFileSync(filePath, updated, 'utf-8')
  }

  return { ok: true, path: relative(root, filePath), replacements }
}

export async function workspaceMove(params: {
  workspacePath: string
  from: string
  to: string
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error }
  const root = rootCheck.root as string
  const fromCheck = resolveWithinWorkspace(root, String(params.from || ''))
  const toCheck = resolveWithinWorkspace(root, String(params.to || ''))
  if (!fromCheck.ok) return { ok: false, error: fromCheck.error }
  if (!toCheck.ok) return { ok: false, error: toCheck.error }

  const fromPath = fromCheck.path as string
  const toPath = toCheck.path as string
  if (!existsSync(fromPath)) return { ok: false, error: 'source not found' }
  mkdirSync(dirname(toPath), { recursive: true })
  renameSync(fromPath, toPath)

  return { ok: true, from: relative(root, fromPath), to: relative(root, toPath) }
}

export async function workspaceDelete(params: {
  workspacePath: string
  path: string
  recursive?: boolean
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error }
  const root = rootCheck.root as string
  const resolvedCheck = resolveWithinWorkspace(root, String(params.path || ''))
  if (!resolvedCheck.ok) return { ok: false, error: resolvedCheck.error }
  const target = resolvedCheck.path as string
  if (!existsSync(target)) return { ok: false, error: 'path not found' }

  const isDirectory = statSync(target).isDirectory()
  if (isDirectory && !params.recursive) {
    return { ok: false, error: 'directory delete requires recursive=true' }
  }

  rmSync(target, { recursive: Boolean(params.recursive), force: false })
  return { ok: true, path: relative(root, target) }
}

export async function workspaceGlobSearch(params: {
  workspacePath: string
  pattern: string
  path?: string
  limit?: number
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error, matches: [] as string[] }
  const root = rootCheck.root as string
  const baseCheck = resolveWithinWorkspace(root, String(params.path || '.'))
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error, matches: [] as string[] }
  const base = baseCheck.path as string
  if (!existsSync(base)) return { ok: false, error: 'path not found', matches: [] as string[] }

  const regex = globToRegExp(String(params.pattern || '**/*'))
  const limit = Math.max(1, Math.min(Number(params.limit || 200), 5000))
  const files = scanFiles(root, base, limit * 3)
  const matches = files
    .map((file) => relative(root, file))
    .filter((relPath) => regex.test(relPath))
    .slice(0, limit)

  return { ok: true, matches }
}

export async function workspaceSearch(params: {
  workspacePath: string
  pattern: string
  path?: string
  include?: string
  limit?: number
  regex?: boolean
  ignore_case?: boolean
}) {
  const rootCheck = ensureWorkspaceRoot(params.workspacePath)
  if (!rootCheck.ok) return { ok: false, error: rootCheck.error, matches: [] as WorkspaceSearchMatch[] }
  const root = rootCheck.root as string
  const baseCheck = resolveWithinWorkspace(root, String(params.path || '.'))
  if (!baseCheck.ok) return { ok: false, error: baseCheck.error, matches: [] as WorkspaceSearchMatch[] }
  const base = baseCheck.path as string
  if (!existsSync(base)) return { ok: false, error: 'path not found', matches: [] as WorkspaceSearchMatch[] }

  const includeRegex = params.include ? globToRegExp(String(params.include)) : null
  const rawPattern = String(params.pattern || '')
  if (!rawPattern) return { ok: false, error: 'pattern is required', matches: [] as WorkspaceSearchMatch[] }
  const lineMatcher = params.regex
    ? new RegExp(rawPattern, params.ignore_case ? 'i' : undefined)
    : null
  const needle = params.ignore_case ? rawPattern.toLowerCase() : rawPattern

  const limit = Math.max(1, Math.min(Number(params.limit || 200), 2000))
  const files = scanFiles(root, base, limit * 20)
  const matches: Array<{ path: string; line: number; text: string }> = []

  for (const file of files) {
    const relPath = relative(root, file)
    if (includeRegex && !includeRegex.test(relPath)) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]
      const ok = lineMatcher
        ? lineMatcher.test(line)
        : (params.ignore_case ? line.toLowerCase().includes(needle) : line.includes(needle))
      if (!ok) continue
      matches.push({ path: relPath, line: idx + 1, text: line.slice(0, 300) })
      if (matches.length >= limit) break
    }
    if (matches.length >= limit) break
  }

  return { ok: true, matches }
}
