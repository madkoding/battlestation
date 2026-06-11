import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

let dbInstance: SqlJsDatabase | null = null
let dbPromise: Promise<SqlJsDatabase> | null = null

const DB_PATH = join(homedir(), '.kosmos', 'kosmos.db')

export async function getDb(): Promise<SqlJsDatabase> {
  if (dbInstance) return dbInstance

  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const SQL = await initSqlJs()

    const dir = join(homedir(), '.kosmos')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    try {
      if (existsSync(DB_PATH)) {
        const buffer = readFileSync(DB_PATH)
        dbInstance = new SQL.Database(buffer)
      } else {
        dbInstance = new SQL.Database()
      }
    } catch (err: unknown) {
      console.warn('[db] Failed to load DB, backing up corrupt file and creating new DB:', err)
      try {
        const backupPath = `${DB_PATH}.corrupt.${Date.now()}`
        renameSync(DB_PATH, backupPath)
        console.log(`[db] Corrupt DB backed up to ${backupPath}`)
      } catch { /* backup best-effort */ }
      dbInstance = new SQL.Database()
    }

    return dbInstance!
  })()

  return dbPromise
}

export function transaction<T>(db: SqlJsDatabase, fn: () => T): T {
  db.run('BEGIN')
  try {
    const result = fn()
    db.run('COMMIT')
    return result
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }
}

const SAVE_DEBOUNCE_MS = 200
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function saveDb(db: SqlJsDatabase) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(DB_PATH, buffer)
  }, SAVE_DEBOUNCE_MS)
}

export function flushDb(db: SqlJsDatabase) {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(DB_PATH, buffer)
}

export function closeDb(db: SqlJsDatabase) {
  flushDb(db)
  db.close()
  dbInstance = null
  dbPromise = null
}

export function execParams(db: SqlJsDatabase, sql: string, params?: (string | number | Uint8Array | null)[]): { columns: string[]; values: (string | number | Uint8Array | null)[][] }[] {
  if (params && params.length > 0) {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const columns = stmt.getColumnNames()
    const values: (string | number | Uint8Array | null)[][] = []
    while (stmt.step()) {
      values.push(stmt.get())
    }
    stmt.free()
    return columns.length > 0 ? [{ columns, values }] : []
  }
  return db.exec(sql)
}
