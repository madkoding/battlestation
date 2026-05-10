import { getDb, saveDb } from '../db/sqlite-client'
import { v4 as uuid } from 'uuid'
import { compilePolicyRegex } from '@kosmos/shared'
import { broadcast } from '../ws-server'
import { gitInit, gitCreateWorktree, gitListWorktreeArtifacts } from './git'
import { listQaEvidence } from './qa-evidence-store'
import { getRuntimePolicy } from './policy'

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

function now() {
  return new Date().toISOString()
}

function rowToObject(columns: string[], row: unknown[]): TaskRecord {
  const obj = {} as TaskRecord
  columns.forEach((col, i) => { obj[col] = row[i] })
  return obj
}

function escape(str: string | undefined | null): string {
  if (!str) return ''
  return String(str).replace(/'/g, "''")
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
  return result[0].values.map((row) => rowToObject(result[0].columns, row))
}

export async function getProject(id: string) {
  const db = await getDb()
  const result = db.exec(`SELECT * FROM projects WHERE id = '${id}'`)
  if (!result.length || !result[0].values.length) return null
  return rowToObject(result[0].columns, result[0].values[0])
}

export async function createProject(data: { name: string; path: string; color?: string; description?: string }) {
  const db = await getDb()
  const id = uuid()
  const timestamp = now()

  db.run(`INSERT INTO projects (id, name, path, color, description, is_hidden, created_at, updated_at)
    VALUES ('${id}', '${escape(data.name)}', '${escape(data.path)}', '${escape(data.color)}', '${escape(data.description)}', 0, '${timestamp}', '${timestamp}')`)

  saveDb(db)
  return getProject(id)
}

export async function updateProject(id: string, data: { name?: string; path?: string; color?: string; description?: string }) {
  const current = await getProject(id)
  if (!current) return null

  const db = await getDb()
  const timestamp = now()

  const nextName = escape(data.name ?? current.name)
  const nextPath = escape(data.path ?? current.path)
  const nextColor = escape(data.color ?? current.color)
  const nextDescription = escape(data.description ?? current.description)

  db.run(`UPDATE projects
    SET name = '${nextName}',
        path = '${nextPath}',
        color = '${nextColor}',
        description = '${nextDescription}',
        updated_at = '${timestamp}'
    WHERE id = '${id}'`)

  saveDb(db)
  return getProject(id)
}

export async function deleteProject(id: string) {
  const db = await getDb()
  db.run(`DELETE FROM tasks WHERE project_id = '${id}'`)
  db.run(`DELETE FROM projects WHERE id = '${id}'`)
  saveDb(db)
}

export async function getTasks(projectId: string, status?: TaskStatus, includeSubtasks = true) {
  const db = await getDb()
  let query = `SELECT * FROM tasks WHERE project_id = '${projectId}'`
  if (status) {
    query += ` AND status = '${status}'`
  }
  if (!includeSubtasks) {
    query += ` AND task_kind = 'task'`
  }
  query += ' ORDER BY created_at DESC'

  const result = db.exec(query)
  if (!result.length || !result[0].values.length) return []
  return result[0].values.map((row) => rowToObject(result[0].columns, row))
}

export async function getTask(id: string) {
  const db = await getDb()
  const result = db.exec(`SELECT * FROM tasks WHERE id = '${id}'`)
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
    VALUES ('${id}', '${data.project_id}', '${escape(data.title)}', '${escape(data.description)}', 'todo', '${data.priority || 'medium'}', 'task', '${escape(workspacePath)}', 0, 0, 0, '${timestamp}', '${timestamp}')`)

  saveDb(db)
  broadcast({ type: 'task:created', payload: { task_id: id, project_id: data.project_id } })
  return getTask(id)
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
  const resolvedAgent = toStatus === 'todo'
    ? ''
    : (agentName || task.assigned_to || '')
  const agent = escape(resolvedAgent)
  let createdComment = false

  db.run(`UPDATE tasks SET status = '${toStatus}', updated_at = '${timestamp}', assigned_to = '${agent}' WHERE id = '${id}'`)

  if (commentText) {
    db.run(`INSERT INTO task_comments (id, task_id, agent_name, comment, created_at)
      VALUES ('${uuid()}', '${id}', '${agent}', '${escape(commentText)}', '${timestamp}')`)
    createdComment = true
  }

  if (toStatus === 'progress' && fromStatus === 'todo') {
    const project = await getProject(task.project_id)
    if (project?.path) {
      try {
        const gitResult = gitInit(project.path)
        const branchName = `task/${id.slice(0, 8)}`
        const worktreeResult = gitCreateWorktree(project.path, branchName, id)

        db.run(`UPDATE tasks SET work_branch = 'task/${id.slice(0, 8)}', base_branch = '${gitResult.base_branch}' WHERE id = '${id}'`)

        if (commentText) {
          db.run(`INSERT INTO task_comments (id, task_id, agent_name, comment, created_at)
            VALUES ('${uuid()}', '${id}', 'system', 'Worktree created: ${worktreeResult.worktree_path}', '${timestamp}')`)
          createdComment = true
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Unknown error')
        console.error('[kanban] Git worktree error:', message)
      }
    }
  }

  saveDb(db)
  broadcast({ type: 'task:updated', payload: { task_id: id, project_id: task.project_id } })
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
  const agent = escape(agentName || 'wedge')
  const assignee = 'vicks'

  db.run(`UPDATE tasks SET status = 'progress', assigned_to = '${assignee}', updated_at = '${timestamp}' WHERE id = '${id}'`)
  db.run(`INSERT INTO task_comments (id, task_id, agent_name, comment, created_at)
    VALUES ('${uuid()}', '${id}', '${agent}', 'QA REJECTED: ${escape(reason)}', '${timestamp}')`)

  saveDb(db)
  broadcast({ type: 'task:updated', payload: { task_id: id, project_id: task.project_id } })
  broadcast({ type: 'task:comment_created', payload: { task_id: id, project_id: task.project_id } })
  return getTask(id)
}

export async function getComments(taskId: string) {
  const db = await getDb()
  const safeTaskId = escape(taskId)
  const result = db.exec(
    `SELECT * FROM task_comments WHERE task_id = '${safeTaskId}' ORDER BY created_at ASC, id ASC`
  )
  if (!result.length || !result[0].values.length) return []
  return result[0].values.map((row) => rowToObject(result[0].columns, row))
}

export async function getCommentsPaginated(taskId: string, options: GetCommentsPageOptions = {}): Promise<PaginatedCommentsResult> {
  const db = await getDb()
  const safeTaskId = escape(taskId)
  const limit = resolveCommentLimit(options.limit)
  const offset = resolveCommentOffset(options.offset)
  const order = resolveCommentOrder(options.order)

  const totalResult = db.exec(`SELECT COUNT(*) AS total FROM task_comments WHERE task_id = '${safeTaskId}'`)
  const total = totalResult.length && totalResult[0].values.length
    ? Number(totalResult[0].values[0][0] || 0)
    : 0

  const rowsResult = db.exec(
    `SELECT * FROM task_comments WHERE task_id = '${safeTaskId}' ORDER BY created_at ${order}, id ${order} LIMIT ${limit} OFFSET ${offset}`
  )

  const comments = rowsResult.length && rowsResult[0].values.length
    ? rowsResult[0].values.map((row) => rowToObject(rowsResult[0].columns, row))
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

  db.run(`INSERT INTO task_comments (id, task_id, agent_id, agent_name, comment, created_at)
    VALUES ('${id}', '${taskId}', '${escape(agentId)}', '${escape(agentName)}', '${escape(comment)}', '${timestamp}')`)

  if (isEscalationComment) {
    db.run(`UPDATE tasks
      SET escalation_count = COALESCE(escalation_count, 0) + 1,
          last_escalated_at = '${timestamp}',
          updated_at = '${timestamp}'
      WHERE id = '${taskId}'`)
  }

  saveDb(db)
  const task = await getTask(taskId)
  if (task) {
    broadcast({ type: 'task:comment_created', payload: { task_id: taskId, project_id: task.project_id } })
  }

  const result = db.exec(`SELECT * FROM task_comments WHERE id = '${id}'`)
  if (!result.length || !result[0].values.length) return null
  return rowToObject(result[0].columns, result[0].values[0])
}

export async function touchTaskActivity(taskId: string, agentName?: string, clearAssignment = false) {
  const db = await getDb()
  const timestamp = now()
  const agent = escape(agentName || '')
  const assignmentSql = clearAssignment
    ? "''"
    : `CASE WHEN '${agent}' = '' THEN assigned_to ELSE '${agent}' END`
  db.run(`UPDATE tasks SET updated_at = '${timestamp}', assigned_to = ${assignmentSql} WHERE id = '${escape(taskId)}'`)
  saveDb(db)
  const task = await getTask(taskId)
  if (task) {
    broadcast({ type: 'task:updated', payload: { task_id: taskId, project_id: task.project_id } })
  }
  return task
}
