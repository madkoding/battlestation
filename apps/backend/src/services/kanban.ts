import { getDb, saveDb, execParams } from '../db/sqlite-client'
import { v4 as uuid } from 'uuid'
import { compilePolicyRegex } from '@kosmos/shared'
import { broadcast } from '../ws-server'
import { gitInit, gitCreateWorktree, gitListWorktreeArtifacts } from './git'
import { listQaEvidence } from './qa-evidence-store'
import { getRuntimePolicy } from './policy'
import { logger } from '../lib/logger'

type TaskRecord = {
  id: string
  project_id: string
  title?: string
  description?: string
  status?: string
  assigned_to?: string
  priority?: string
  task_kind?: string
  parent_task_id?: string
  workspace_path?: string
  work_branch?: string
  base_branch?: string
  release_approved?: boolean | number
  approved_by?: string
  approved_branch?: string
  approved_push?: boolean | number
  approved_at?: string
  jira_ready?: boolean | number
  escalation_count?: number
  requeue_count?: number
  last_requeued_at?: string
  last_escalated_at?: string
  created_at?: string
  updated_at?: string
  name?: string
  path?: string
  color?: string
  [key: string]: unknown
}

type TaskCommentRecord = {
  id?: string
  task_id?: string
  agent_id?: string
  agent_name?: string
  comment?: string
  created_at?: string
  [key: string]: unknown
}

const STATUS_FLOW = ['todo', 'progress', 'qa', 'done'] as const
export type TaskStatus = 'todo' | 'progress' | 'qa' | 'done'
const COMMENT_PAGE_DEFAULT_LIMIT = 5
const COMMENT_PAGE_MAX_LIMIT = 50

export interface GetCommentsPageOptions {
  limit?: number
  offset?: number
  order?: 'asc' | 'desc'
}

export interface PaginatedCommentsResult {
  comments: TaskCommentRecord[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  next_offset: number | null
}

function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const fromIdx = STATUS_FLOW.indexOf(from)
  const toIdx = STATUS_FLOW.indexOf(to)

  if (fromIdx === -1 || toIdx === -1) return false
  if (to === 'done' && from !== 'qa') return false
  if (from === 'qa' && to === 'progress') return true
  if (from === 'progress' && to === 'todo') return true
  return toIdx === fromIdx + 1
}

let _lastMs = 0
function now(): string {
  _lastMs = Math.max(_lastMs + 1, Date.now())
  return new Date(_lastMs).toISOString()
}

function rowToObject(columns: string[], row: unknown[]): TaskRecord {
  const obj = {} as TaskRecord
  columns.forEach((col, i) => { obj[col] = row[i] })
  return obj
}

function resolveCommentLimit(value?: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return COMMENT_PAGE_DEFAULT_LIMIT
  }
  return Math.min(COMMENT_PAGE_MAX_LIMIT, Math.floor(parsed))
}

function resolveCommentOffset(value?: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return Math.floor(parsed)
}

function resolveCommentOrder(value?: string): 'ASC' | 'DESC' {
  return String(value || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
}

function resolveWorktreePath(task: TaskRecord): string {
  const workspace = String(task.workspace_path || '').trim()
  const branch = String(task.work_branch || '').trim()
  if (!workspace) return ''
  if (!branch) return workspace
  return `${workspace}/.worktrees/${branch}`
}

function isLikelyFrontendTaskText(text: string): boolean {
  const policy = getRuntimePolicy('global')
  const frontendPattern = compilePolicyRegex(
    policy.classification.frontend_task_pattern,
    /frontend|ui|ux|react|vite|next|tailwind|css|html|component|layout|responsive|dashboard|modal|kanban|playwright|screenshot/i,
  )
  const documentationPattern = compilePolicyRegex(
    policy.classification.documentation_task_pattern,
    /release|deployment|deploy|documentation|docs|runbook|handoff|contribution/i,
  )
  const normalizedText = String(text || '').toLowerCase()
  const isDocumentation = documentationPattern.test(normalizedText)
  const isFrontend = frontendPattern.test(normalizedText)
  if (isDocumentation && !isFrontend) return false
  return isFrontend
}

async function enforceProgressToQaGate(task: TaskRecord): Promise<void> {
  const policy = getRuntimePolicy('vicks')
  const deliveryGate = policy.delivery_gate
  const worktreePath = resolveWorktreePath(task)
  const artifacts = worktreePath
    ? gitListWorktreeArtifacts({
        worktreePath,
        repoPath: String(task.workspace_path || ''),
        baseBranch: String(task.base_branch || ''),
        workBranch: String(task.work_branch || ''),
      })
    : null

  const changedCount = artifacts?.changed_files?.length || 0
  const branchDiffCount = artifacts?.files_between_branches?.length || 0

  if (deliveryGate.require_code_delta && changedCount === 0 && branchDiffCount === 0) {
    throw new Error('Delivery gate blocked: no code delta detected for progress->qa transition')
  }

  const contextText = `${String(task.title || '')}\n${String(task.description || '')}`
  if (!deliveryGate.require_frontend_qa_evidence || !isLikelyFrontendTaskText(contextText)) {
    return
  }

  const evidence = await listQaEvidence(task.id)
  const latest = evidence[0]
  const screenshots = latest?.payload?.screenshots?.length || 0
  const executed = Boolean(latest?.payload?.executed)

  if (!latest || !executed || screenshots === 0) {
    throw new Error('Delivery gate blocked: frontend task requires successful QA screenshot evidence before QA handoff')
  }
}

export async function listProjects() {
  const db = await getDb()
  const result = db.exec("SELECT * FROM projects ORDER BY created_at DESC")
  if (!result.length || !result[0].values.length) return []
  return result[0].values.map((row: unknown[]) => rowToObject(result[0].columns, row))
}

export async function getProject(id: string) {
  const db = await getDb()
  const result = execParams(db, `SELECT * FROM projects WHERE id = ?`, [id])
  if (!result.length || !result[0].values.length) return null
  return rowToObject(result[0].columns, result[0].values[0])
}

function broadcastProjects() {
  broadcast({ type: 'project_status', payload: undefined })
}

export async function createProject(data: { name: string; path: string; color?: string; description?: string }) {
  const db = await getDb()
  const id = uuid()
  const timestamp = now()

  db.run(`INSERT INTO projects (id, name, path, color, description, is_hidden, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)`, [id, data.name, data.path, data.color ?? null, data.description ?? null, timestamp, timestamp])

  saveDb(db)
  broadcastProjects()
  return getProject(id)
}

export async function updateProject(id: string, data: { name?: string; path?: string; color?: string; description?: string }) {
  const current = await getProject(id)
  if (!current) return null

  const db = await getDb()
  const timestamp = now()

  db.run(`UPDATE projects
    SET name = ?,
        path = ?,
        color = ?,
        description = ?,
        updated_at = ?
    WHERE id = ?`, [data.name ?? String(current.name ?? ''), data.path ?? String(current.path ?? ''), data.color ?? String(current.color ?? ''), data.description ?? String(current.description ?? ''), timestamp, id])

  saveDb(db)
  broadcastProjects()
  return getProject(id)
}

export async function deleteProject(id: string) {
  const db = await getDb()
  db.run('BEGIN')
  try {
    db.run(`DELETE FROM tasks WHERE project_id = ?`, [id])
    db.run(`DELETE FROM projects WHERE id = ?`, [id])
    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }
  saveDb(db)
  broadcastProjects()
}

export async function getTasks(projectId: string, status?: TaskStatus, includeSubtasks = true) {
  const db = await getDb()
  const params: (string | number | null)[] = [projectId]
  let query = `SELECT * FROM tasks WHERE project_id = ?`
  if (status) {
    query += ` AND status = ?`
    params.push(status)
  }
  if (!includeSubtasks) {
    query += ` AND task_kind = 'task'`
  }
  query += ' ORDER BY created_at DESC'

  const result = execParams(db, query, params)
  if (!result.length || !result[0].values.length) return []
  return result[0].values.map((row) => rowToObject(result[0].columns, row))
}

export async function getTask(id: string) {
  const db = await getDb()
  const result = execParams(db, `SELECT * FROM tasks WHERE id = ?`, [id])
  if (!result.length || !result[0].values.length) return null
  return rowToObject(result[0].columns, result[0].values[0])
}

export async function createTask(data: {
  project_id: string
  title: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
}) {
  const db = await getDb()
  const id = uuid()
  const timestamp = now()

  const project = await getProject(data.project_id)
  const workspacePath = project?.path || ''

  db.run(`INSERT INTO tasks (id, project_id, title, description, status, priority, task_kind, workspace_path, release_approved, approved_push, jira_ready, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'todo', ?, 'task', ?, 0, 0, 0, ?, ?)`, [id, data.project_id, data.title, data.description || null, data.priority || 'medium', workspacePath, timestamp, timestamp])

  saveDb(db)
  broadcast({ type: 'task:created', payload: { task_id: id, project_id: data.project_id } })
  return getTask(id)
}

export async function updateTask(id: string, data: {
  title?: string
  description?: string
  priority?: string
  assigned_to?: string
}) {
  const db = await getDb()
  const timestamp = now()
  const sets: string[] = []
  const params: (string | number | null)[] = []

  if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title) }
  if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description) }
  if (data.priority !== undefined) { sets.push('priority = ?'); params.push(data.priority) }
  if (data.assigned_to !== undefined) { sets.push('assigned_to = ?'); params.push(data.assigned_to) }

  if (!sets.length) return getTask(id)

  sets.push('updated_at = ?')
  params.push(timestamp)
  params.push(id)

  db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params)
  saveDb(db)

  const task = await getTask(id)
  if (task) {
    broadcast({ type: 'task:updated', payload: { task_id: id, project_id: task.project_id } })
  }
  return task
}

export async function moveTask(id: string, toStatus: TaskStatus, agentName?: string, commentText?: string) {
  const task = await getTask(id)
  if (!task) throw new Error('Task not found')

  const fromStatus = task.status as TaskStatus
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new Error(`Invalid transition from ${fromStatus} to ${toStatus}`)
  }

  if (fromStatus === 'progress' && toStatus === 'qa') {
    await enforceProgressToQaGate(task)
  }

  const db = await getDb()
  const timestamp = now()
  const agent = toStatus === 'todo'
    ? ''
    : (agentName || task.assigned_to || '')
  let createdComment = false

  db.run('BEGIN')
  try {
    db.run(`UPDATE tasks SET status = ?, updated_at = ?, assigned_to = ? WHERE id = ?`, [toStatus, timestamp, agent, id])

    if (commentText) {
      db.run(`INSERT INTO task_comments (id, task_id, agent_name, comment, created_at)
        VALUES (?, ?, ?, ?, ?)`, [uuid(), id, agent, commentText, timestamp])
      createdComment = true
    }

    if (toStatus === 'progress' && fromStatus === 'todo') {
      const project = await getProject(task.project_id)
      if (project?.path) {
        try {
          const gitResult = gitInit(project.path)
          const branchName = `task/${id.slice(0, 8)}`
          const worktreeResult = gitCreateWorktree(project.path, branchName, id)

          const workBranch = `task/${id.slice(0, 8)}`
          db.run(`UPDATE tasks SET work_branch = ?, base_branch = ? WHERE id = ?`, [workBranch, gitResult.base_branch, id])

          if (commentText) {
            const systemComment = `Worktree created: ${worktreeResult.worktree_path}`
            db.run(`INSERT INTO task_comments (id, task_id, agent_name, comment, created_at)
              VALUES (?, ?, 'system', ?, ?)`, [uuid(), id, systemComment, timestamp])
            createdComment = true
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error || 'Unknown error')
          logger.error(`Git worktree error: ${message}`)
        }
      }
    }

    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }

  saveDb(db)
  broadcast({ type: 'task:updated', payload: { task_id: id, project_id: task.project_id } })
  if (toStatus === 'qa' && fromStatus === 'progress') {
    broadcast({ type: 'qa:ready_for_approval', payload: { task_id: id } })
  }
  if (createdComment) {
    broadcast({ type: 'task:comment_created', payload: { task_id: id, project_id: task.project_id } })
  }
  return getTask(id)
}

export async function rejectTask(id: string, reason: string, agentName?: string) {
  const task = await getTask(id)
  if (!task) throw new Error('Task not found')
  if (task.status !== 'qa') throw new Error('Can only reject tasks in QA')

  const db = await getDb()
  const timestamp = now()
  const agent = agentName || 'wedge'

  db.run('BEGIN')
  try {
    db.run(`UPDATE tasks SET status = 'progress', assigned_to = 'vicks', updated_at = ? WHERE id = ?`, [timestamp, id])
    db.run(`INSERT INTO task_comments (id, task_id, agent_name, comment, created_at)
      VALUES (?, ?, ?, ?, ?)`, [uuid(), id, agent, `QA REJECTED: ${reason}`, timestamp])
    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }

  saveDb(db)
  broadcast({ type: 'task:updated', payload: { task_id: id, project_id: task.project_id } })
  broadcast({ type: 'task:comment_created', payload: { task_id: id, project_id: task.project_id } })
  return getTask(id)
}

export async function deleteTask(id: string) {
  const task = await getTask(id)
  if (!task) throw new Error('Task not found')

  const db = await getDb()
  db.run('BEGIN')
  try {
    db.run(`DELETE FROM task_comments WHERE task_id = ?`, [id])
    db.run(`DELETE FROM qa_evidence WHERE task_id = ?`, [id])
    db.run(`DELETE FROM tasks WHERE id = ?`, [id])
    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }
  saveDb(db)
  broadcast({ type: 'task:deleted', payload: { task_id: id, project_id: task.project_id } })
}

export async function getComments(taskId: string) {
  const db = await getDb()
  const result = execParams(db,
    `SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, id ASC`, [taskId]
  )
  if (!result.length || !result[0].values.length) return []
  return result[0].values.map((row: unknown[]) => rowToObject(result[0].columns, row))
}

export async function getCommentsPaginated(taskId: string, options: GetCommentsPageOptions = {}): Promise<PaginatedCommentsResult> {
  const db = await getDb()
  const limit = resolveCommentLimit(options.limit)
  const offset = resolveCommentOffset(options.offset)
  const order = resolveCommentOrder(options.order)

  const totalResult = execParams(db, `SELECT COUNT(*) AS total FROM task_comments WHERE task_id = ?`, [taskId])
  const total = totalResult.length && totalResult[0].values.length
    ? Number(totalResult[0].values[0][0] || 0)
    : 0

  const rowsResult = execParams(db,
    `SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ${order}, id ${order} LIMIT ${limit} OFFSET ${offset}`,
    [taskId]
  )

  const comments = rowsResult.length && rowsResult[0].values.length
    ? rowsResult[0].values.map((row: unknown[]) => rowToObject(rowsResult[0].columns, row))
    : []

  const nextOffset = offset + comments.length
  const hasMore = nextOffset < total

  return {
    comments,
    total,
    limit,
    offset,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
  }
}

export async function addComment(taskId: string, comment: string, agentName?: string, agentId?: string) {
  const db = await getDb()
  const id = uuid()
  const timestamp = now()

  const commentText = String(comment || '')
  const normalizedAgent = String(agentName || '').trim().toLowerCase()
  const escalationMarker = String(getRuntimePolicy('vicks').delivery_gate.escalation_comment_marker || '## Delivery Escalation Required')
  const isEscalationComment = normalizedAgent === 'vicks' && commentText.includes(escalationMarker)

  db.run('BEGIN')
  try {
    db.run(`INSERT INTO task_comments (id, task_id, agent_id, agent_name, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, taskId, agentId || null, agentName || null, comment, timestamp])

    if (isEscalationComment) {
      db.run(`UPDATE tasks
        SET escalation_count = COALESCE(escalation_count, 0) + 1,
            last_escalated_at = ?,
            updated_at = ?
        WHERE id = ?`, [timestamp, timestamp, taskId])
    }

    db.run('COMMIT')
  } catch (err: unknown) {
    db.run('ROLLBACK')
    throw err
  }

  saveDb(db)
  const task = await getTask(taskId)
  if (task) {
    broadcast({ type: 'task:comment_created', payload: { task_id: taskId, project_id: task.project_id } })
  }

  const result = execParams(db, `SELECT * FROM task_comments WHERE id = ?`, [id])
  if (!result.length || !result[0].values.length) return null
  return rowToObject(result[0].columns, result[0].values[0])
}

export async function touchTaskActivity(taskId: string, agentName?: string, clearAssignment = false) {
  const db = await getDb()
  const timestamp = now()
  const agent = agentName || ''

  if (clearAssignment) {
    db.run(`UPDATE tasks SET updated_at = ?, assigned_to = '' WHERE id = ?`, [timestamp, taskId])
  } else if (agent) {
    db.run(`UPDATE tasks SET updated_at = ?, assigned_to = ? WHERE id = ?`, [timestamp, agent, taskId])
  } else {
    db.run(`UPDATE tasks SET updated_at = ? WHERE id = ?`, [timestamp, taskId])
  }

  saveDb(db)
  const task = await getTask(taskId)
  if (task) {
    broadcast({ type: 'task:updated', payload: { task_id: taskId, project_id: task.project_id } })
  }
  return task
}
