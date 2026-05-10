import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
    } catch {
      dbInstance = new SQL.Database()
    }

    return dbInstance!
  })()

  return dbPromise
}

export function saveDb(db: SqlJsDatabase) {
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(DB_PATH, buffer)
}

export function closeDb(db: SqlJsDatabase) {
  saveDb(db)
  db.close()
  dbInstance = null
  dbPromise = null
}
