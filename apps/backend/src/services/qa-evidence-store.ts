import { existsSync } from 'fs'
import { getDb, execParams } from '../db/sqlite-client'

export interface QaEvidenceScreenshot {
  path: string
  url: string
  viewport: 'desktop' | 'mobile' | string
}

export interface QaEvidenceEntry {
  id: string
  task_id: string
  created_at: string
  payload: {
    executed: boolean
    persisted?: boolean
    task_id?: string
    reason?: string
    script?: string
    command?: string
    base_url?: string
    screenshots: QaEvidenceScreenshot[]
    logs: string[]
  }
}

function safeParsePayload(raw: string): QaEvidenceEntry['payload'] {
  try {
    const parsed = JSON.parse(raw) as QaEvidenceEntry['payload']
    return {
      executed: Boolean(parsed?.executed),
      persisted: parsed?.persisted == null ? undefined : Boolean(parsed.persisted),
      task_id: parsed?.task_id ? String(parsed.task_id) : undefined,
      reason: parsed?.reason,
      script: parsed?.script,
      command: parsed?.command,
      base_url: parsed?.base_url,
      screenshots: Array.isArray(parsed?.screenshots) ? parsed.screenshots : [],
      logs: Array.isArray(parsed?.logs) ? parsed.logs.map((line) => String(line)) : [],
    }
  } catch {
    return {
      executed: false,
      reason: 'Invalid qa evidence payload',
      screenshots: [],
      logs: [],
    }
  }
}

export async function listQaEvidence(taskId: string): Promise<QaEvidenceEntry[]> {
  const db = await getDb()
  const result = execParams(db, `SELECT id, task_id, payload, created_at FROM qa_evidence WHERE task_id = ? ORDER BY created_at DESC LIMIT 10`, [taskId])
  if (!result.length || !result[0].values.length) return []

  return result[0].values.map((row: unknown[]) => ({
    id: String(row[0] || ''),
    task_id: String(row[1] || ''),
    payload: safeParsePayload(String(row[2] || '{}')),
    created_at: String(row[3] || ''),
  }))
}

export async function resolveQaEvidenceScreenshot(evidenceId: string, screenshotIndex: number): Promise<{ path: string } | null> {
  const db = await getDb()
  const result = execParams(db, `SELECT payload FROM qa_evidence WHERE id = ? LIMIT 1`, [evidenceId])
  if (!result.length || !result[0].values.length) return null

  const payload = safeParsePayload(String(result[0].values[0][0] || '{}'))
  const screenshot = payload.screenshots[screenshotIndex]
  if (!screenshot?.path) return null
  const screenshotPath = String(screenshot.path)
  if (!existsSync(screenshotPath)) return null

  return { path: screenshotPath }
}
