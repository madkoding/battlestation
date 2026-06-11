import { v4 as uuid } from 'uuid'
import { getDb, saveDb } from '../db/sqlite-client'

const MAX_ACTIVITY_EVENTS = 20

export async function saveLiveActivityEvent(payload: Record<string, unknown>) {
  if (String(payload.type || '').toLowerCase() === 'heartbeat') {
    return
  }

  const db = await getDb()
  const id = uuid()
  const createdAt = new Date().toISOString()
  const payloadText = JSON.stringify(payload)

  db.run('BEGIN')
  try {
    db.run(`INSERT INTO live_activity_events (id, payload, created_at) VALUES (?, ?, ?)`, [id, payloadText, createdAt])
    db.run(`DELETE FROM live_activity_events WHERE id IN (
      SELECT id FROM live_activity_events ORDER BY created_at DESC LIMIT -1 OFFSET ${MAX_ACTIVITY_EVENTS}
    )`)
    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }
  saveDb(db)
}

export async function listLiveActivityEvents(): Promise<Array<Record<string, unknown>>> {
  const db = await getDb()
  const result = db.exec(`SELECT id, payload, created_at FROM live_activity_events ORDER BY created_at DESC LIMIT ${MAX_ACTIVITY_EVENTS}`)

  if (!result.length || !result[0].values.length) {
    return []
  }

  const events: Array<Record<string, unknown>> = []
  for (const row of result[0].values) {
    const id = String(row[0] || '')
    const payloadRaw = String(row[1] || '{}')
    const createdAt = String(row[2] || new Date().toISOString())

    try {
      const payload = JSON.parse(payloadRaw) as Record<string, unknown>
      const normalized: Record<string, unknown> = {
        ...payload,
        id: String(payload.id || id),
        timestamp: String(payload.timestamp || createdAt),
      }
      if (String(normalized.type || '').toLowerCase() !== 'heartbeat') {
        events.push(normalized)
      }
    } catch {
      const fallback = {
        id,
        type: 'activity',
        message: payloadRaw,
        timestamp: createdAt,
      }
      events.push(fallback)
    }
  }

  return events
}

export async function listLiveActivityEventsFiltered(filters?: {
  projectId?: string
  taskId?: string
}): Promise<Array<Record<string, unknown>>> {
  const events = await listLiveActivityEvents()
  const projectId = String(filters?.projectId || '').trim()
  const taskId = String(filters?.taskId || '').trim()

  if (!projectId && !taskId) {
    return events
  }

  return events.filter((event) => {
    const eventProjectId = String(event.project_id || event.projectId || '').trim()
    const eventTaskId = String(event.task_id || event.taskId || '').trim()

    if (projectId && eventProjectId !== projectId) {
      return false
    }
    if (taskId && eventTaskId !== taskId) {
      return false
    }
    return true
  })
}
