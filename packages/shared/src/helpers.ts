export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const WORKSPACE_ALLOWED_ROOTS: string[] = (() => {
  const home = typeof process !== 'undefined' && process.env.HOME ? `${process.env.HOME}/.kosmos` : ''
  const cwd = typeof process !== 'undefined' ? process.env.CWD || process.cwd() : ''
  return [home, cwd, '/tmp'].filter(Boolean)
})()

export const DEFAULT_TIMEOUT_MS = 120_000
export const DEFAULT_PORT = 18792
export const DEFAULT_POLL_MS = 5000
export const POLICY_CACHE_TTL_MS = 5000
export const DEFAULT_WORKSPACE_LIST_LIMIT = 200
export const DEFAULT_WORKSPACE_READ_LIMIT = 400
