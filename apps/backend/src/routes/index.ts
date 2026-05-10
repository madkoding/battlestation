import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import { listProjects, createProject, getProject, updateProject, deleteProject } from '../services/kanban'
import { getTasks, createTask, getTask, moveTask, rejectTask, getComments, getCommentsPaginated, addComment } from '../services/kanban'
import { spawnAgent, killAgent, getActiveAgents, listAvailableProfiles } from '../services/agent-spawner'
import { getConfig, updateConfig } from '../services/config'
import { listLiveActivityEventsFiltered } from '../services/live-activity'
import { listQaEvidence, resolveQaEvidenceScreenshot } from '../services/qa-evidence-store'
import { readProjectAgentsMd, writeProjectAgentsMd } from '../services/agents-md'
import { broadcast } from '../ws-server'
import { getRuntimePolicy } from '../services/policy'

type TaskStatus = 'todo' | 'progress' | 'qa' | 'done'
type TaskPriority = 'low' | 'medium' | 'high'

function parseTaskPriority(value: unknown): TaskPriority | undefined {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  return undefined
}

export async function registerRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  fastify.get('/api/projects', async () => listProjects())

  fastify.post('/api/projects', async (request) => {
    const { name, path, color, description } = request.body as { name: string; path: string; color?: string; description?: string }
    return createProject({ name, path, color, description })
  })

  fastify.patch('/api/projects/:id', async (request) => {
    const { id } = request.params as { id: string }
    const current = await getProject(id)
    if (!current) throw { statusCode: 404, message: 'Project not found' }

    const { name, path, color, description } = request.body as {
      name?: string
      path?: string
      color?: string
      description?: string
    }

    return updateProject(id, {
      name: name ?? current.name,
      path: path ?? current.path,
      color: color ?? current.color,
      description: description ?? current.description,
    })
  })

  fastify.get('/api/projects/:id', async (request) => {
    const { id } = request.params as { id: string }
    const project = await getProject(id)
    if (!project) throw { statusCode: 404, message: 'Project not found' }
    return project
  })

  fastify.delete('/api/projects/:id', async (request) => {
    const { id } = request.params as { id: string }
    await deleteProject(id)
    return { success: true }
  })

  fastify.get('/api/projects/:id/agents-md', async (request) => {
    const { id } = request.params as { id: string }
    const project = await getProject(id)
    if (!project) {
      throw { statusCode: 404, message: 'Project not found' }
    }

    return readProjectAgentsMd({
      projectId: String(project.id || ''),
      projectName: String(project.name || ''),
      projectPath: String(project.path || ''),
    })
  })

  fastify.put('/api/projects/:id/agents-md', async (request) => {
    const { id } = request.params as { id: string }
    const { content } = request.body as { content?: string }
    const project = await getProject(id)
    if (!project) {
      throw { statusCode: 404, message: 'Project not found' }
    }

    return writeProjectAgentsMd({
      projectId: String(project.id || ''),
      projectName: String(project.name || ''),
      projectPath: String(project.path || ''),
      content: String(content || ''),
    })
  })

  fastify.get('/api/projects/:id/tasks', async (request) => {
    const { id } = request.params as { id: string }
    const { status } = request.query as { status?: string }
    const normalizedStatus = (status === 'todo' || status === 'progress' || status === 'qa' || status === 'done')
      ? status
      : undefined
    return getTasks(id, normalizedStatus)
  })

  fastify.post('/api/projects/:id/tasks', async (request) => {
    const { id } = request.params as { id: string }
    const { title, description, priority } = request.body as { title: string; description?: string; priority?: string }
    return createTask({ project_id: id, title, description, priority: parseTaskPriority(priority) })
  })

  fastify.get('/api/tasks', async (request) => {
    const { project_id, status, include_subtasks } = request.query as {
      project_id?: string
      status?: TaskStatus
      include_subtasks?: string | number
    }

    if (!project_id) {
      return { tasks: [], total: 0 }
    }

    const includeSubtasks = String(include_subtasks ?? '1') !== '0'
    const tasks = await getTasks(project_id, status, includeSubtasks)

    return { tasks, total: tasks.length }
  })

  fastify.post('/api/tasks', async (request) => {
    const { project_id, title, description, priority } = request.body as {
      project_id: string
      title: string
      description?: string
      priority?: string
    }
    return createTask({ project_id, title, description, priority: parseTaskPriority(priority) })
  })

  fastify.get('/api/tasks/:id', async (request) => {
    const { id } = request.params as { id: string }
    const task = await getTask(id)
    if (!task) throw { statusCode: 404, message: 'Task not found' }
    return task
  })

  fastify.get('/api/tasks/:id/context', async (request) => {
    const { id } = request.params as { id: string }
    const { include_comments } = request.query as {
      include_comments?: string | number
    }
    const task = await getTask(id)
    if (!task) throw { statusCode: 404, message: 'Task not found' }

    const project = await getProject(task.project_id)
    const includeComments = String(include_comments ?? '1') === '1'
    const comments = includeComments ? await getComments(id) : []
    const subtasks: Array<Record<string, unknown>> = []

    return {
      task,
      project,
      comments,
      subtasks,
      children_by_status: { todo: 0, progress: 0, qa: 0, done: 0 },
    }
  })

  fastify.get('/api/tasks/:id/subtasks', async () => {
    return []
  })

  fastify.patch('/api/tasks/:id', async (request) => {
    const { id } = request.params as { id: string }
    const { to_status, agent_name, comment_text } = request.body as {
      to_status: 'todo' | 'progress' | 'qa' | 'done'
      agent_name?: string
      comment_text?: string
    }
    return moveTask(id, to_status, agent_name, comment_text)
  })

  fastify.post('/api/tasks/:id/transition', async (request) => {
    const { id } = request.params as { id: string }
    const { to_status, agent_name, comment_text, qa_rejection } = request.body as {
      to_status: TaskStatus
      agent_name?: string
      comment_text?: string
      qa_rejection?: { root_cause?: string }
    }

    if (to_status === 'progress' && qa_rejection?.root_cause) {
      return rejectTask(id, qa_rejection.root_cause, agent_name)
    }

    return moveTask(id, to_status, agent_name, comment_text)
  })

  fastify.post('/api/tasks/:id/approve_qa', async (request) => {
    const { id } = request.params as { id: string }
    const { approved_by } = request.body as { approved_by?: string }
    const approvedBy = approved_by || 'human'
    const task = await moveTask(id, 'done', approvedBy, 'QA approved by human')

    broadcast({
      type: 'qa:approval_confirmed',
      payload: {
        task_id: id,
        approved_by: approvedBy,
      },
    })

    return task
  })

  fastify.get('/api/tasks/metrics', async () => {
    const projects = await listProjects()
    const totals = { todo: 0, progress: 0, qa: 0, done: 0, escalations: 0, requeues: 0 }

    for (const project of projects) {
      const tasks = await getTasks(project.id)
      for (const task of tasks as Array<Record<string, unknown>>) {
        const status = String(task.status) as TaskStatus
        if (status in totals) {
          totals[status as keyof typeof totals] += 1
        }
        totals.escalations += Number(task.escalation_count || 0)
        totals.requeues += Number(task.requeue_count || 0)
      }
    }

    return totals
  })

  fastify.delete('/api/tasks/:id', async () => {
    return { success: true }
  })

  fastify.get('/api/tasks/:id/comments', async (request) => {
    const { id } = request.params as { id: string }
    const { limit, offset, order } = request.query as {
      limit?: string | number
      offset?: string | number
      order?: string
    }

    const parsedLimit = limit == null ? undefined : Number(limit)
    const parsedOffset = offset == null ? undefined : Number(offset)

    return getCommentsPaginated(id, {
      limit: Number.isFinite(parsedLimit as number) ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset as number) ? parsedOffset : undefined,
      order: String(order || '').toLowerCase() === 'asc' ? 'asc' : 'desc',
    })
  })

  fastify.get('/api/tasks/:id/qa-evidence', async (request) => {
    const { id } = request.params as { id: string }
    const evidence = await listQaEvidence(id)
    return { evidence }
  })

  fastify.get('/api/tasks/:id/qa-evidence/:evidenceId/screenshots/:index', async (request, reply) => {
    const { evidenceId, index } = request.params as { id: string; evidenceId: string; index: string }
    const screenshot = await resolveQaEvidenceScreenshot(evidenceId, Number(index))
    if (!screenshot) {
      reply.code(404)
      return { error: 'Screenshot not found' }
    }
    const buffer = readFileSync(screenshot.path)
    reply.header('Content-Type', 'image/png')
    return reply.send(buffer)
  })

  fastify.post('/api/tasks/:id/comments', async (request) => {
    const { id } = request.params as { id: string }
    const { comment, agent_name } = request.body as { comment: string; agent_name?: string }
    return addComment(id, comment, agent_name)
  })

  fastify.get('/api/agents', async () => {
    const profiles = listAvailableProfiles()
    const active = getActiveAgents()
    return { profiles, active }
  })

  fastify.post('/api/agents/spawn', async (request) => {
    const { profile_id } = request.body as { profile_id: string }
    return spawnAgent(profile_id)
  })

  fastify.post('/api/agents/kill/:pid', async (request) => {
    const { pid } = request.params as { pid: string }
    const success = await killAgent(Number(pid))
    return { success }
  })

  fastify.get('/api/agents/active', async () => getActiveAgents())

  fastify.get('/api/activity/live', async (request) => {
    const { project_id, task_id } = request.query as { project_id?: string; task_id?: string }
    const activities = await listLiveActivityEventsFiltered({
      projectId: project_id,
      taskId: task_id,
    })
    return { activities }
  })

  fastify.get('/api/config', async () => getConfig())

  fastify.put('/api/config', async (request) => {
    const { partial } = request.body as { partial: Record<string, unknown> }
    return updateConfig(partial)
  })

  fastify.post('/api/workflow/run-cycle', async () => {
    const active = getActiveAgents()
    const hasKosmosRunning = active.some((agent) => String(agent.profile_id || '').toLowerCase() === 'kosmos')
    if (!hasKosmosRunning) {
      await spawnAgent('kosmos')
    }
    return { processed: hasKosmosRunning ? 0 : 1 }
  })

  fastify.post('/api/config/unlock', async () => {
    const policy = getRuntimePolicy('global')
    return { unlocked: true, policy_version: policy.version }
  })
}
