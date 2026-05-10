import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { chromium, type Browser } from 'playwright'

export interface PlaywrightShot {
  path: string
  url: string
  viewport: 'desktop' | 'mobile'
}

export interface PlaywrightRunResult {
  ok: boolean
  screenshots: PlaywrightShot[]
  logs: string[]
  reason?: string
}

function slugifyPath(url: string): string {
  const cleaned = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 80) || 'root'
}

function wait(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitForMeaningfulContent(page: Awaited<ReturnType<Browser['newPage']>>, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const ready = await page.evaluate(() => {
      const root = document.querySelector('#root, main, [data-testid="app-root"], body') as HTMLElement | null
      if (!root) return false
      const text = (root.innerText || '').replace(/\s+/g, '').trim()
      const hasMedia = root.querySelectorAll('img,svg,canvas,video').length > 0
      const rect = root.getBoundingClientRect()
      const hasVisibleArea = rect.width > 100 && rect.height > 100
      return hasVisibleArea && (text.length > 10 || hasMedia)
    }).catch(() => false)
    if (ready) return true
    await wait(350)
  }
  return false
}

async function isLikelyBlankCapture(page: Awaited<ReturnType<Browser['newPage']>>): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('#root, main, [data-testid="app-root"], body') as HTMLElement | null
    if (!root) return true
    const text = (root.innerText || '').replace(/\s+/g, '').trim()
    const hasMedia = root.querySelectorAll('img,svg,canvas,video').length > 0
    return text.length < 15 && !hasMedia
  }).catch(() => true)
}

async function ensureBrowserLaunch(logs: string[]): Promise<Browser> {
  const runInstall = (): Promise<{ ok: boolean; output: string }> => new Promise((resolve) => {
    const proc = spawn('npx', ['playwright', 'install', 'chromium'], {
      cwd: process.cwd(),
      env: { ...process.env, CI: '1' },
    })
    let output = ''
    proc.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    proc.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    proc.on('close', (code) => {
      resolve({ ok: code === 0, output: output.trim() })
    })
  })

  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logs.push(`playwright launch failed: ${message}`)
    const missingExecutable = /Executable doesn't exist|browserType\.launch:.*download|install/i.test(message)
    if (!missingExecutable) {
      throw error
    }

    logs.push('attempting playwright chromium install...')
    const install = await runInstall()
    if (!install.ok) {
      logs.push(`playwright install failed: ${install.output.slice(0, 500)}`)
      throw error
    }
    logs.push('playwright chromium installed successfully')
    return chromium.launch({ headless: true })
  }
}

async function captureUrlScreenshots(params: {
  browser: Browser
  url: string
  evidenceDir: string
  logs: string[]
}): Promise<PlaywrightShot[]> {
  const { browser, url, evidenceDir, logs } = params
  const shots: PlaywrightShot[] = []
  const slug = slugifyPath(url)

  const desktopPath = join(evidenceDir, `desktop-${slug}-${Date.now()}.png`)
  const mobilePath = join(evidenceDir, `mobile-${slug}-${Date.now()}.png`)

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  desktop.on('console', (message) => {
    const text = message.text().trim()
    if (text) logs.push(`console:${text}`)
  })
  desktop.on('pageerror', (error) => {
    logs.push(`pageerror:${error.message}`)
  })
  try {
    await desktop.goto(url, { waitUntil: 'networkidle', timeout: 25000 })
    await waitForMeaningfulContent(desktop, 8000)
    await wait(300)
    await desktop.screenshot({ path: desktopPath, fullPage: false })
    if (await isLikelyBlankCapture(desktop)) {
      logs.push(`desktop capture looked blank for ${url}, retrying after delay`)
      await wait(500)
      await desktop.screenshot({ path: desktopPath, fullPage: false })
    }
    if (existsSync(desktopPath)) {
      shots.push({ path: desktopPath, url, viewport: 'desktop' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logs.push(`desktop capture failed for ${url}: ${message}`)
  } finally {
    await desktop.close()
  }

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  mobile.on('console', (message) => {
    const text = message.text().trim()
    if (text) logs.push(`console:${text}`)
  })
  mobile.on('pageerror', (error) => {
    logs.push(`pageerror:${error.message}`)
  })
  try {
    await mobile.goto(url, { waitUntil: 'networkidle', timeout: 25000 })
    await waitForMeaningfulContent(mobile, 9000)
    await wait(350)
    await mobile.screenshot({ path: mobilePath, fullPage: false })
    if (await isLikelyBlankCapture(mobile)) {
      logs.push(`mobile capture looked blank for ${url}, retrying after delay`)
      await wait(600)
      await mobile.screenshot({ path: mobilePath, fullPage: false })
    }
    if (existsSync(mobilePath)) {
      shots.push({ path: mobilePath, url, viewport: 'mobile' })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logs.push(`mobile capture failed for ${url}: ${message}`)
  } finally {
    await mobile.close()
  }

  return shots
}

export async function runPlaywrightScreenshots(params: {
  workspacePath: string
  outputDir: string
  urls: string[]
  maxUrls?: number
}): Promise<PlaywrightRunResult> {
  const workspacePath = String(params.workspacePath || '').trim()
  const outputDir = String(params.outputDir || '').trim()
  const urls = Array.isArray(params.urls)
    ? params.urls.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const maxUrls = Math.max(1, Math.min(Number(params.maxUrls || 6), 20))

  const logs: string[] = []
  if (!workspacePath || !existsSync(workspacePath)) {
    return {
      ok: false,
      screenshots: [],
      logs,
      reason: 'Workspace path is missing or not found',
    }
  }

  if (!outputDir) {
    return {
      ok: false,
      screenshots: [],
      logs,
      reason: 'Output directory is required',
    }
  }

  if (urls.length === 0) {
    return {
      ok: false,
      screenshots: [],
      logs,
      reason: 'At least one URL is required',
    }
  }

  mkdirSync(outputDir, { recursive: true })
  logs.push(`playwright starting in ${workspacePath}`)

  let browser: Browser | null = null
  try {
    browser = await ensureBrowserLaunch(logs)
    const screenshots: PlaywrightShot[] = []
    for (const url of urls.slice(0, maxUrls)) {
      const perUrl = await captureUrlScreenshots({ browser, url, evidenceDir: outputDir, logs })
      screenshots.push(...perUrl)
    }

    return {
      ok: screenshots.length > 0,
      screenshots,
      logs,
      reason: screenshots.length > 0 ? undefined : 'No screenshots could be captured',
    }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}
