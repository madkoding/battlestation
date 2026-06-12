const B = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const R = '\x1b[0m'

export function logger(profile: string) {
  const prefix = `${DIM}[${R}${CYAN}${B}${profile}${R}${DIM}]${R}`
  return {
    info: (msg: string) => console.log(`  ${prefix} ${msg}`),
    warn: (msg: string) => console.log(`  ${prefix} ${YELLOW}${B}⚠${R} ${YELLOW}${msg}${R}`),
    error: (msg: string) => console.log(`  ${prefix} ${RED}${B}✗${R} ${RED}${msg}${R}`),
    success: (msg: string) => console.log(`  ${prefix} ${GREEN}${B}✓${R} ${GREEN}${msg}${R}`),
    detail: (key: string, val: string) => console.log(`  ${prefix} ${DIM}${key}:${R} ${val}`),
  }
}
