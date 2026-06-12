const B = '\x1b[1m'
const DIM = '\x1b[2m'
const GRAY = '\x1b[90m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const R = '\x1b[0m'

function label(tag: string, color: string): string {
  return `${DIM}[${R}${color}${B}${tag}${R}${DIM}]${R}`
}

export const logger = {
  info: (msg: string) => console.log(`  ${GRAY}${msg}${R}`),
  success: (msg: string) => console.log(`  ${GREEN}${B}✓${R} ${GREEN}${msg}${R}`),
  warn: (msg: string) => console.log(`  ${YELLOW}${B}⚠${R} ${YELLOW}${msg}${R}`),
  error: (msg: string, err?: unknown) => {
    console.log(`  ${RED}${B}✗${R} ${RED}${msg}${R}`)
    if (err) console.log(`    ${DIM}${String(err)}${R}`)
  },
  ws: (msg: string) => console.log(`  ${label('ws', CYAN)} ${CYAN}${msg}${R}`),
  db: (msg: string) => console.log(`  ${label('db', GREEN)} ${GREEN}${msg}${R}`),
  git: (msg: string, extra?: string) => {
    console.log(`  ${label('git', YELLOW)} ${YELLOW}${msg}${R}`)
    if (extra) console.log(`    ${DIM}${extra}${R}`)
  },
  agent: (profile: string, msg: string) => console.log(`  ${label(profile, CYAN)} ${CYAN}${msg}${R}`),
}
