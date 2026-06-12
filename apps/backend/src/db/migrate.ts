import { getDb, saveDb, transaction } from '../db/sqlite-client'
import { logger } from '../lib/logger'

export async function runMigrations() {
  const db = await getDb()

  transaction(db, () => {
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    color TEXT,
    description TEXT,
    banner_image_url TEXT,
    is_hidden INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo' NOT NULL,
    assigned_to TEXT,
    priority TEXT DEFAULT 'medium' NOT NULL,
    task_kind TEXT DEFAULT 'task' NOT NULL,
    parent_task_id TEXT,
    workspace_path TEXT,
    work_branch TEXT,
    base_branch TEXT,
    release_approved INTEGER DEFAULT 0,
    approved_by TEXT,
    approved_branch TEXT,
    approved_push INTEGER DEFAULT 0,
    approved_at TEXT,
    jira_ready INTEGER DEFAULT 0,
    escalation_count INTEGER DEFAULT 0,
    requeue_count INTEGER DEFAULT 0,
    last_escalated_at TEXT,
    last_requeued_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    agent_id TEXT,
    agent_name TEXT,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)

  db.run('CREATE INDEX IF NOT EXISTS idx_task_comments_task_created_at ON task_comments(task_id, created_at)')

  db.run(`CREATE TABLE IF NOT EXISTS config_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS running_agents (
    pid INTEGER PRIMARY KEY,
    profile_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    last_heartbeat TEXT,
    heartbeat_message TEXT
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS live_activity_events (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS qa_evidence (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)

  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_status_assigned ON tasks(status, assigned_to)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_qa_evidence_task_id ON qa_evidence(task_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_live_activity_events_created ON live_activity_events(created_at)')

  try {
    const cols = db.exec("PRAGMA table_info(running_agents)")
    const names = new Set<string>()
    if (cols.length && cols[0].values.length) {
      for (const row of cols[0].values) {
        names.add(String(row[1]))
      }
    }

    if (!names.has('last_heartbeat')) {
      db.run('ALTER TABLE running_agents ADD COLUMN last_heartbeat TEXT')
    }
    if (!names.has('heartbeat_message')) {
      db.run('ALTER TABLE running_agents ADD COLUMN heartbeat_message TEXT')
    }
  } catch {
    // ignore migration compatibility errors
  }

  try {
    const taskCols = db.exec('PRAGMA table_info(tasks)')
    const taskColumnNames = new Set<string>()
    if (taskCols.length && taskCols[0].values.length) {
      for (const row of taskCols[0].values) {
        taskColumnNames.add(String(row[1]))
      }
    }

    if (!taskColumnNames.has('escalation_count')) {
      db.run('ALTER TABLE tasks ADD COLUMN escalation_count INTEGER DEFAULT 0')
    }
    if (!taskColumnNames.has('requeue_count')) {
      db.run('ALTER TABLE tasks ADD COLUMN requeue_count INTEGER DEFAULT 0')
    }
    if (!taskColumnNames.has('last_escalated_at')) {
      db.run('ALTER TABLE tasks ADD COLUMN last_escalated_at TEXT')
    }
    if (!taskColumnNames.has('last_requeued_at')) {
      db.run('ALTER TABLE tasks ADD COLUMN last_requeued_at TEXT')
    }
  } catch {
    // ignore migration compatibility errors
  }

  })
  saveDb(db)
  logger.db('Migrations complete')
}
