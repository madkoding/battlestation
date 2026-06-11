import type {
  TaskStatus,
  Priority,
  Project,
  AgentProfile,
} from '@kosmos/shared'

export type {
  TaskStatus,
  Priority,
  Project,
  Task,
  TaskContext,
  TransitionTaskInput,
  ApproveQaInput,
  TaskComment,
  CreateCommentInput,
  CreateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
  AgentProfile,
} from '@kosmos/shared'

// Activity (frontend uses camelCase)
// Activity (both camelCase and snake_case from normalizeActivity)
export interface Activity {
  id?: string
  type: string
  agent: string
  agentId?: string
  agentName?: string
  agent_id?: string
  agent_name?: string
  message: string
  currentTask?: string
  current_task?: string
  taskId?: string
  task_id?: string
  taskTitle?: string
  task_title?: string
  projectId?: string
  project_id?: string
  projectName?: string
  project_name?: string
  status?: string
  mood?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

// Agent
export interface Agent {
  id: string
  name: string
  type: 'agent'
  status: 'working' | 'resting'
  mood: 'focused' | 'busy' | 'happy' | 'tired' | 'excited' | 'satisfied' | 'relaxed' | 'sleepy'
  currentTask?: string
  projectId?: string
  lastActivity: string
}

export interface AgentWorkflow {
  roles: {
    orchestrator: string
    developer: string
    qa: string
  }
  status_owners: Record<string, string>
  transition_owners: Record<string, string>
}

export interface AgentsCatalogResponse {
  agents: Agent[]
  runtime_agents?: Agent[]
  runtime_total?: number
  profiles: AgentProfile[]
  profiles_total?: number
  workflow: AgentWorkflow
  total: number
}

// Settings
export interface Settings {
  theme: string
  density: 'normal' | 'compact'
  crtFx: 'on' | 'off'
}

// API Response
export interface ApiResponse<T> {
  data?: T
  error?: string
  message?: string
}

// WebSocket Messages
export interface WSMessage {
  type: string
  payload: unknown
}

export interface ActivityWSMessage extends WSMessage {
  type: 'activity'
  payload: Activity
}

export interface TaskUpdatedWSMessage extends WSMessage {
  type: 'task:updated'
  payload: { task_id: string; project_id: string }
}

export interface TaskCreatedWSMessage extends WSMessage {
  type: 'task:created'
  payload: { task_id: string; project_id: string }
}

export interface ProjectStatusWSMessage extends WSMessage {
  type: 'project_status'
  payload: Project[]
}

// Filters
export interface TaskFilters {
  status?: TaskStatus | 'all'
  priority?: Priority | 'all'
  assigned_to?: string | 'all'
  query?: string
}
