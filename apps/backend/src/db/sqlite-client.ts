import { join, dirname } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { logger } from '../lib/logger'

let dbInstance: SqlJsDatabase | null = null
let dbPromise: Promise<SqlJsDatabase> | null = null

let saveTimer: ReturnType<typeof setTimeout> | null = null

function getDbPath(): string {
  return process.env.KOSMOS_DB_PATH || join(homedir(), '.kosmos', 'kosmos.db')
}

export async function getDb(): Promise<SqlJsDatabase> {
  if (dbInstance) return dbInstance

  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const SQL = await initSqlJs()

    const dbPath = getDbPath()
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    try {
      if (existsSync(dbPath)) {
        const buffer = readFileSync(dbPath)
        dbInstance = new SQL.Database(buffer)
      } else {
        dbInstance = new SQL.Database()
      }
    } catch (err: unknown) {
      logger.warn('Failed to load DB, backing up corrupt file and creating new DB')
      if (err) console.error(err)
      try {
        const backupPath = `${dbPath}.corrupt.${Date.now()}`
        renameSync(dbPath, backupPath)
        logger.info(`Corrupt DB backed up to ${backupPath}`)
      } catch { /* backup best-effort */ }
      dbInstance = new SQL.Database()
    }

    return dbInstance!
  })()

  return dbPromise
}

export function resetDb(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (dbInstance) {
    flushDb(dbInstance)
    dbInstance.close()
    dbInstance = null
  }
  dbPromise = null
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

export function saveDb(db: SqlJsDatabase) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(getDbPath(), buffer)
  }, SAVE_DEBOUNCE_MS)
}

export function flushDb(db: SqlJsDatabase) {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(getDbPath(), buffer)
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
