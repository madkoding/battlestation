import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetDb } from '../db/sqlite-client'

export function setupTestDb(): string {
  const dbDir = mkdtempSync(join(tmpdir(), 'kosmos-test-'))
  const dbPath = join(dbDir, 'test.db')
  process.env.KOSMOS_DB_PATH = dbPath
  resetDb()
  return dbDir
}

export function cleanupTestDb(dbDir: string) {
  resetDb()
  rmSync(dbDir, { recursive: true, force: true })
}
