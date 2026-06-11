import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import { listProjects, createProject, getProject, updateProject, deleteProject, deleteTask } from '../services/kanban'
import { getTasks, createTask, getTask, updateTask, moveTask, rejectTask, getComments, getCommentsPaginated, addComment } from '../services/kanban'
import { spawnAgent, killAgent, getActiveAgents, listAvailableProfiles } from '../services/agent-spawner'
import { getConfig, updateConfig } from '../services/config'
import { listLiveActivityEventsFiltered } from '../services/live-activity'
import { listQaEvidence, resolveQaEvidenceScreenshot } from '../services/qa-evidence-store'
import { readProjectAgentsMd, writeProjectAgentsMd } from '../services/agents-md'
import { broadcast } from '../ws-server'
import { getRuntimePolicy } from '../services/policy'
import {
  CreateProjectInputSchema,
  IdParamSchema,
  UpdateProjectInputSchema,
  ProjectTasksQuerySchema,
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  TaskContextQuerySchema,
  CommentsQuerySchema,
  SpawnAgentBodySchema,
  ApproveQaBodySchema,
  AddCommentBodySchema,
  AgentsMdBodySchema,
  UpdateConfigBodySchema,
  LiveActivityQuerySchema,
  TransitionTaskBodySchema,
  PidParamSchema,
  EvidenceScreenshotParamsSchema,
} from '@kosmos/shared'

export async function registerRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  fastify.get('/api/projects', async () => listProjects())

  fastify.post('/api/projects', async (request) => {
    const data = CreateProjectInputSchema.parse(request.body)
    return createProject(data)
  })

  fastify.patch('/api/projects/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const current = await getProject(id)
    if (!current) throw { statusCode: 404, message: 'Project not found' }

    const data = UpdateProjectInputSchema.parse(request.body)

    return updateProject(id, {
      name: data.name ?? current.name,
      path: data.path ?? current.path,
      color: data.color ?? current.color,
      description: data.description ?? current.description,
    })
  })

  fastify.get('/api/projects/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const project = await getProject(id)
    if (!project) throw { statusCode: 404, message: 'Project not found' }
    return project
  })

  fastify.delete('/api/projects/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    await deleteProject(id)
    return { success: true }
  })

  fastify.get('/api/projects/:id/agents-md', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
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
    const { id } = IdParamSchema.parse(request.params)
    const { content } = AgentsMdBodySchema.parse(request.body)
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
    const { id } = IdParamSchema.parse(request.params)
    const { status } = ProjectTasksQuerySchema.parse(request.query)
    const normalizedStatus = (status === 'todo' || status === 'progress' || status === 'qa' || status === 'done')
      ? status
      : undefined
    return getTasks(id, normalizedStatus)
  })

  fastify.post('/api/projects/:id/tasks', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const data = CreateTaskInputSchema.parse({ ...(request.body as Record<string, unknown>), project_id: id })
    return createTask({ project_id: id, title: data.title, description: data.description, priority: data.priority })
  })

  fastify.get('/api/tasks', async (request) => {
    const query = ProjectTasksQuerySchema.parse(request.query)

    if (!query.project_id) {
      return { tasks: [], total: 0 }
    }

    const includeSubtasks = String(query.include_subtasks ?? '1') !== '0'
    const tasks = await getTasks(query.project_id, query.status, includeSubtasks)

    return { tasks, total: tasks.length }
  })

  fastify.post('/api/tasks', async (request) => {
    const data = CreateTaskInputSchema.parse(request.body)
    return createTask(data)
  })

  fastify.get('/api/tasks/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const task = await getTask(id)
    if (!task) throw { statusCode: 404, message: 'Task not found' }
    return task
  })

  fastify.get('/api/tasks/:id/context', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const query = TaskContextQuerySchema.parse(request.query)
    const task = await getTask(id)
    if (!task) throw { statusCode: 404, message: 'Task not found' }

    const project = await getProject(task.project_id)
    const includeComments = String(query.include_comments ?? '1') === '1'
    const comments = includeComments ? await getComments(id) : []

    return {
      task,
      project,
      comments,
      subtasks: [],
      children_by_status: { todo: 0, progress: 0, qa: 0, done: 0 },
    }
  })

  fastify.get('/api/tasks/:id/subtasks', async () => {
    return []
  })

  fastify.patch('/api/tasks/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const data = UpdateTaskInputSchema.parse(request.body)
    return updateTask(id, data)
  })

  fastify.post('/api/tasks/:id/transition', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const data = TransitionTaskBodySchema.parse(request.body)

    if (data.to_status === 'progress' && data.qa_rejection?.root_cause) {
      return rejectTask(id, data.qa_rejection.root_cause, data.agent_name)
    }

    return moveTask(id, data.to_status, data.agent_name, data.comment_text)
  })

  fastify.post('/api/tasks/:id/approve_qa', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const data = ApproveQaBodySchema.parse(request.body)
    const approvedBy = data.approved_by || 'human'
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
      for (const task of tasks) {
        const status = String(task.status)
        if (status === 'todo' || status === 'progress' || status === 'qa' || status === 'done') {
          totals[status] += 1
        }
        totals.escalations += Number(task.escalation_count || 0)
        totals.requeues += Number(task.requeue_count || 0)
      }
    }

    return totals
  })

  fastify.delete('/api/tasks/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const task = await getTask(id)
    if (!task) throw { statusCode: 404, message: 'Task not found' }
    await deleteTask(id)
    return { success: true }
  })

  fastify.get('/api/tasks/:id/comments', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const query = CommentsQuerySchema.parse(request.query)

    return getCommentsPaginated(id, {
      limit: query.limit,
      offset: query.offset,
      order: query.order || 'desc',
    })
  })

  fastify.get('/api/tasks/:id/qa-evidence', async (request) => {
    const { id } = IdParamSchema.parse(request.params)
    const evidence = await listQaEvidence(id)
    return { evidence }
  })

  fastify.get('/api/tasks/:id/qa-evidence/:evidenceId/screenshots/:index', async (request, reply) => {
    const { evidenceId, index } = EvidenceScreenshotParamsSchema.parse(request.params)
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
    const { id } = IdParamSchema.parse(request.params)
    const data = AddCommentBodySchema.parse(request.body)
    return addComment(id, data.comment, data.agent_name)
  })

  fastify.get('/api/agents', async () => {
    const profiles = listAvailableProfiles()
    const active = await getActiveAgents()
    return { profiles, active }
  })

  fastify.post('/api/agents/spawn', async (request) => {
    const { profile_id } = SpawnAgentBodySchema.parse(request.body)
    return spawnAgent(profile_id)
  })

  fastify.post('/api/agents/kill/:pid', async (request) => {
    const { pid } = PidParamSchema.parse(request.params)
    const success = await killAgent(Number(pid))
    return { success }
  })

  fastify.get('/api/agents/active', async () => await getActiveAgents())

  fastify.get('/api/activity/live', async (request) => {
    const query = LiveActivityQuerySchema.parse(request.query)
    const activities = await listLiveActivityEventsFiltered({
      projectId: query.project_id,
      taskId: query.task_id,
    })
    return { activities }
  })

  fastify.get('/api/config', async () => getConfig())

  fastify.put('/api/config', async (request) => {
    const { partial } = UpdateConfigBodySchema.parse(request.body)
    return updateConfig(partial)
  })

  fastify.post('/api/workflow/run-cycle', async () => {
    const active = await getActiveAgents()
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
