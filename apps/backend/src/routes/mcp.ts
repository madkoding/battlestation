import type { FastifyInstance } from 'fastify'
import { listProjects, createProject, getProject, deleteProject } from '../services/kanban'
import { getTasks, createTask, getTask, moveTask, rejectTask, getComments, addComment, touchTaskActivity } from '../services/kanban'
import type { TaskStatus } from '../services/kanban'
import { spawnAgent, killAgent, getActiveAgents, listAvailableProfiles, heartbeatAgent } from '../services/agent-spawner'
import { getConfig, updateConfig } from '../services/config'
import { gitInit, gitCreateWorktree, gitMergeWorktree, gitDeleteWorktree, gitListWorktreeArtifacts } from '../services/git'
import { broadcast } from '../ws-server'
import { runFrontendQaEvidence, runPlaywrightCapture } from '../services/qa-evidence'
import { listQaEvidence } from '../services/qa-evidence-store'
import { runWorkspaceCommand } from '../services/workspace-exec'
import { workspaceDelete, workspaceEdit, workspaceGlobSearch, workspaceList, workspaceMove, workspaceRead, workspaceSearch, workspaceWrite } from '../services/workspace-fs'
import { readProjectAgentsMd } from '../services/agents-md'

const NOISY_METHODS = new Set([
  'list_projects',
  'get_tasks',
  'heartbeat_agent',
  'get_qa_evidence',
  'touch_task',
  'workspace_list',
  'workspace_read',
  'workspace_glob',
  'workspace_search',
])

type ToolArgs = Record<string, unknown>
type TaskPriority = 'low' | 'medium' | 'high'
type ConfigShape = Awaited<ReturnType<typeof getConfig>>

function asRecord(value: unknown): ToolArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as ToolArgs
}

function asString(value: unknown): string {
  return String(value || '')
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim()
  return normalized ? normalized : undefined
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '').toLowerCase()
  return normalized === 'true' || normalized === '1'
}

function parseTaskStatus(value: unknown): TaskStatus | undefined {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'todo' || normalized === 'progress' || normalized === 'qa' || normalized === 'done') {
    return normalized
  }
  return undefined
}

function parseTaskPriority(value: unknown): TaskPriority | undefined {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  return undefined
}

function requireTaskStatus(value: unknown, context: string): TaskStatus {
  const status = parseTaskStatus(value)
  if (!status) {
    throw new Error(`${context}: invalid task status`)
  }
  return status
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function formatActionMessage(method: string, params: ToolArgs): string {
  const taskId = String(params.id || params.task_id || '').trim()
  const projectId = String(params.project_id || '').trim()

  switch (method) {
    case 'create_task':
      return `Creating task: ${String(params.title || 'untitled')}`
    case 'move_task':
      return `Moving task to ${String(params.to_status || 'next stage')}`
    case 'reject_task':
      return `Rejecting task for rework`
    case 'get_task':
      return 'Reading task details'
    case 'get_comments':
      return 'Reading task comments'
    case 'add_comment':
      return `Posting implementation note`
    case 'spawn_agent':
      return `Spawning ${String(params.profile_id || 'agent')}`
    case 'git_init':
      return 'Initializing git workspace'
    case 'git_create_worktree':
      return 'Creating git worktree'
    case 'git_merge_worktree':
      return 'Merging git worktree'
    case 'git_delete_worktree':
      return 'Cleaning git worktree'
    case 'update_config':
      return 'Updating runtime config'
    case 'workspace_exec':
      return 'Executing workspace command'
    case 'workspace_list':
      return 'Listing workspace files'
    case 'workspace_read':
      return 'Reading workspace file'
    case 'workspace_write':
      return 'Writing workspace file'
    case 'workspace_edit':
      return 'Editing workspace file'
    case 'workspace_move':
      return 'Moving workspace path'
    case 'workspace_delete':
      return 'Deleting workspace path'
    case 'workspace_glob':
      return 'Searching files by glob'
    case 'workspace_search':
      return 'Searching text in workspace'
    case 'run_playwright':
      return 'Running Playwright screenshots'
    default:
      if (taskId) return `${method.replace(/_/g, ' ')} on task`
      if (projectId) return `${method.replace(/_/g, ' ')} in project`
      return method.replace(/_/g, ' ')
  }
}

interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: ToolArgs
}

interface MCPToolHandler {
  (args: ToolArgs): Promise<unknown>
}

const tools: Record<string, MCPToolHandler> = {
  list_projects: async () => listProjects(),

  create_project: async (args) =>
    createProject({
      name: asString(args.name),
      path: asString(args.path),
      color: asOptionalString(args.color),
      description: asOptionalString(args.description),
    }),

  get_project: async (args) => {
    const project = await getProject(asString(args.id))
    if (!project) throw new Error('Project not found')
    return project
  },

  delete_project: async (args) => {
    await deleteProject(asString(args.id))
    return { success: true }
  },

  get_tasks: async (args) =>
    getTasks(asString(args.project_id), parseTaskStatus(args.status)),

  get_task: async (args) => {
    const task = await getTask(asString(args.id))
    if (!task) throw new Error('Task not found')
    return task
  },

  create_task: async (args) =>
    createTask({
      project_id: asString(args.project_id),
      title: asString(args.title),
      description: asOptionalString(args.description),
      priority: parseTaskPriority(args.priority),
    }),

  move_task: async (args) =>
    moveTask(
      asString(args.id),
      requireTaskStatus(args.to_status, 'move_task'),
      asOptionalString(args.agent_name),
      asOptionalString(args.comment_text),
    ),

  reject_task: async (args) =>
    rejectTask(asString(args.id), asString(args.reason)),

  get_comments: async (args) =>
    getComments(asString(args.task_id)),

  add_comment: async (args) =>
    addComment(
      asString(args.task_id),
      asString(args.comment),
      asOptionalString(args.agent_name),
    ),

  touch_task: async (args) =>
    touchTaskActivity(asString(args.task_id), asOptionalString(args.agent_name)),

  list_agents: async () => listAvailableProfiles(),

  spawn_agent: async (args) =>
    spawnAgent(asString(args.profile_id)),

  kill_agent: async (args) => ({
    success: await killAgent(asNumber(args.pid, 0)),
  }),

  heartbeat_agent: async (args) =>
    heartbeatAgent(asNumber(args.pid, 0), asOptionalString(args.message)),

  get_active_agents: async () => getActiveAgents(),

  get_config: async () => getConfig(),

  update_config: async (args) =>
    updateConfig(asRecord(args.partial) as Partial<ConfigShape>),

  git_init: async (args) => gitInit(asString(args.path)),

  git_create_worktree: async (args) =>
    gitCreateWorktree(
      asString(args.path),
      asString(args.branch_name),
      asString(args.task_id),
    ),

  git_merge_worktree: async (args) =>
    gitMergeWorktree(asString(args.branch_name), asString(args.task_id)),

  git_delete_worktree: async (args) =>
    gitDeleteWorktree(asString(args.branch_name)),

  git_list_worktree_artifacts: async (args) =>
    gitListWorktreeArtifacts({
      worktreePath: asString(args.worktree_path),
      repoPath: asOptionalString(args.repo_path),
      baseBranch: asOptionalString(args.base_branch),
      workBranch: asOptionalString(args.work_branch),
    }),

  run_frontend_qa_evidence: async (args) =>
    runFrontendQaEvidence({
      workspacePath: asString(args.workspace_path),
      taskId: asString(args.task_id),
    }),

  run_playwright: async (args) =>
    runPlaywrightCapture({
      workspacePath: asString(args.workspace_path),
      taskId: asOptionalString(args.task_id),
      baseUrl: asOptionalString(args.base_url),
      urls: asStringArray(args.urls),
      script: asOptionalString(args.script),
      outputSubdir: asOptionalString(args.output_subdir),
      maxUrls: asNumber(args.max_urls, 6),
    }),

  get_qa_evidence: async (args) =>
    listQaEvidence(asString(args.task_id)),

  get_project_agents_md: async (args) => {
    const project = await getProject(asString(args.project_id))
    if (!project) {
      throw new Error('Project not found')
    }
    return readProjectAgentsMd({
      projectId: String(project.id || ''),
      projectName: String(project.name || ''),
      projectPath: String(project.path || ''),
    })
  },

  workspace_exec: async (args) =>
    runWorkspaceCommand({
      workspacePath: asString(args.workspace_path),
      command: asString(args.command),
      timeoutMs: asNumber(args.timeout_ms, 120000),
    }),

  workspace_list: async (args) =>
    workspaceList({
      workspacePath: asString(args.workspace_path),
      path: asOptionalString(args.path),
      recursive: asBoolean(args.recursive),
      limit: asNumber(args.limit, 200),
    }),

  workspace_read: async (args) =>
    workspaceRead({
      workspacePath: asString(args.workspace_path),
      path: asString(args.path),
      offset: asNumber(args.offset, 1),
      limit: asNumber(args.limit, 400),
    }),

  workspace_write: async (args) =>
    workspaceWrite({
      workspacePath: asString(args.workspace_path),
      path: asString(args.path),
      content: asString(args.content),
      append: asBoolean(args.append),
    }),

  workspace_edit: async (args) =>
    workspaceEdit({
      workspacePath: asString(args.workspace_path),
      path: asString(args.path),
      find: asString(args.find),
      replace: asString(args.replace),
      all: asBoolean(args.all),
      regex: asBoolean(args.regex),
      ignore_case: asBoolean(args.ignore_case),
    }),

  workspace_move: async (args) =>
    workspaceMove({
      workspacePath: asString(args.workspace_path),
      from: asString(args.from),
      to: asString(args.to),
    }),

  workspace_delete: async (args) =>
    workspaceDelete({
      workspacePath: asString(args.workspace_path),
      path: asString(args.path),
      recursive: asBoolean(args.recursive),
    }),

  workspace_glob: async (args) =>
    workspaceGlobSearch({
      workspacePath: asString(args.workspace_path),
      pattern: asString(args.pattern),
      path: asOptionalString(args.path),
      limit: asNumber(args.limit, 200),
    }),

  workspace_search: async (args) =>
    workspaceSearch({
      workspacePath: asString(args.workspace_path),
      pattern: asString(args.pattern),
      path: asOptionalString(args.path),
      include: asOptionalString(args.include),
      limit: asNumber(args.limit, 200),
      regex: asBoolean(args.regex),
      ignore_case: asBoolean(args.ignore_case),
    }),
}

export async function registerMCPRoutes(fastify: FastifyInstance) {
  fastify.post('/mcp', async (request) => {
    const body = request.body as MCPRequest

    const { id, method, params } = body
    const safeParams = asRecord(params)
    const agentName = String(safeParams._agent || safeParams.agent_name || 'agent')

    const handler = tools[method]
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }
    }

    try {
      const result = await handler(safeParams)
      const resultRecord = asRecord(result)

      if (!NOISY_METHODS.has(method)) {
        const taskId = String(safeParams.id || safeParams.task_id || resultRecord.id || '').trim()
        const projectId = String(safeParams.project_id || resultRecord.project_id || '').trim()
        const message = formatActionMessage(method, safeParams)

        broadcast({
          type: 'activity',
          payload: {
            type: 'agent_action',
            agent: agentName,
            message,
            task_id: taskId || undefined,
            project_id: projectId || undefined,
            timestamp: new Date().toISOString(),
          },
        })
      }

      return {
        jsonrpc: '2.0',
        id,
        result,
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error || 'Internal error')
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message },
      }
    }
  })

  fastify.get('/mcp/tools', async () => {
    return Object.keys(tools).map((name) => ({ name }))
  })
}
