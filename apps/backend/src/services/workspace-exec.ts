import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { DEFAULT_TIMEOUT_MS } from '@kosmos/shared'

function trimOutput(value: string, maxChars = 8000): string {
  const text = String(value || '')
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

export async function runWorkspaceCommand(params: {
  workspacePath: string
  command: string
  timeoutMs?: number
}): Promise<{
  ok: boolean
  command: string
  exit_code: number | null
  stdout: string
  stderr: string
  duration_ms: number
  timed_out: boolean
}> {
  const workspacePath = String(params.workspacePath || '').trim()
  const command = String(params.command || '').trim()
  const timeoutMs = Number(params.timeoutMs || DEFAULT_TIMEOUT_MS)

  if (!workspacePath || !existsSync(workspacePath)) {
    return {
      ok: false,
      command,
      exit_code: null,
      stdout: '',
      stderr: 'Workspace path does not exist',
      duration_ms: 0,
      timed_out: false,
    }
  }

  if (!command) {
    return {
      ok: false,
      command,
      exit_code: null,
      stdout: '',
      stderr: 'Command is required',
      duration_ms: 0,
      timed_out: false,
    }
  }

  const startedAt = Date.now()
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: workspacePath,
      env: { ...process.env, CI: '1' },
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !timedOut,
        command,
        exit_code: code,
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        duration_ms: Date.now() - startedAt,
        timed_out: timedOut,
      })
    })
  })
}
