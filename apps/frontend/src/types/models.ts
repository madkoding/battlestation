import type { TaskStatus, Priority } from '@/lib/constants'

// Project
export interface Project {
  id: string
  name: string
  path: string
  color?: string
  description?: string | null
  banner_image_url?: string | null
  is_hidden: boolean
  task_count: number
  created_at: string
  updated_at: string
}

export interface CreateProjectInput {
  name: string
  path: string
  color?: string
  description?: string
  banner_image_url?: string
}

// Task
export interface Task {
  id: string
  project_id: string
  title: string
  description?: string
  status: TaskStatus
  assigned_to: string
  priority: Priority
  task_kind: 'task' | 'subtask'
  parent_task_id?: string | null
  workspace_path?: string
  work_branch?: string
  base_branch?: string
  release_approved: boolean
  approved_by?: string | null
  approved_branch?: string | null
  approved_push: boolean
  approved_at?: string | null
  jira_ready: boolean
  stage_notified_stage?: string | null
  stage_notified_at?: string | null
  release_ready_notified_at?: string | null
  retry_count?: number
  last_failure_reason?: string | null
  escalation_count?: number
  requeue_count?: number
  last_escalated_at?: string | null
  last_requeued_at?: string | null
  created_at: string
  updated_at: string
  // Computed
  subtask_count?: number
  completed_subtasks?: number
}

export interface TaskContext {
  task: Task
  project: Project
  comments: TaskComment[]
  subtasks: Task[]
  children_by_status: Record<string, number>
}

export interface CreateTaskInput {
  project_id: string
  title: string
  description?: string
  status?: TaskStatus
  priority?: Priority
  parent_task_id?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: Priority
  assigned_to?: string
}

export interface TransitionTaskInput {
  to_status: TaskStatus
  agent_name?: string
  comment_text?: string
  qa_checklist?: {
    scope_complete?: boolean
    self_review_done?: boolean
    tests_passed?: boolean
    diff_attached?: boolean
  }
  qa_rejection?: {
    root_cause?: string
    repro_steps?: string
    impacted_files?: string
    failed_checks?: string[]
  }
}

export interface ApproveQaInput {
  approved_by: string
  branch: string
  push: boolean
}

// Comments
export interface TaskComment {
  id: string
  task_id: string
  agent_id?: string
  agent_name?: string
  comment: string
  created_at: string
}

export interface CreateCommentInput {
  comment: string
  agent_name?: string
}

// Activity
export interface Activity {
  id?: string
  type: string
  agent: string
  agentId?: string
  agentName?: string
  message: string
  currentTask?: string
  task_id?: string
  taskId?: string
  task_title?: string
  taskTitle?: string
  project_id?: string
  projectId?: string
  project_name?: string
  projectName?: string
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

export interface AgentProfile {
  id: string
  name: string
  role: string
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
