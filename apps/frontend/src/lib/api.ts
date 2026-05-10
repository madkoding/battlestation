import axios from 'axios'
import { API_BASE_URL } from '@/lib/constants'
import type {
  Project, 
  CreateProjectInput, 
  Task, 
  CreateTaskInput, 
  UpdateTaskInput,
  TaskContext,
  TransitionTaskInput,
  ApproveQaInput,
  TaskComment,
  CreateCommentInput,
  Activity,
  Agent,
  AgentsCatalogResponse,
} from '@/types/models'

export interface ProviderSettings {
  provider: 'ollama' | 'openai' | 'github_copilot' | 'anthropic' | 'google'
  profile: 'local' | 'cloud'
  model: string
  base_url: string
  api_key: string
  verify_tls: boolean
}

export const SECRET_MASK = '********'

export interface ProviderCapability {
  id: ProviderSettings['provider']
  label: string
  ready: boolean
  mode: string
  supports_local: boolean
}

export interface ProviderCapabilitiesResponse {
  providers: ProviderCapability[]
  chat_compatible: string[]
}

export interface ProviderModelsResponse {
  provider: ProviderSettings['provider']
  models: string[]
  selected: string
}

export interface ProviderTestResponse {
  provider: ProviderSettings['provider']
  ok: boolean
  message: string
  checked_at?: string
  stages?: {
    models_ok: boolean
    chat_ok: boolean
  }
}

export interface ProviderHealthResponse {
  providers: Partial<Record<ProviderSettings['provider'], {
    ok: boolean
    message: string
    checked_at: string
    stages?: {
      models_ok: boolean
      chat_ok: boolean
    }
  }>>
}

export interface ProjectAgentsMdResponse {
  project_id: string
  path: string
  content: string
}

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

export interface TaskCommentsPage {
  comments: TaskComment[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  next_offset: number | null
}

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message || 'Unknown error'
    console.error('API Error:', message)
    return Promise.reject(new Error(message))
  }
)

// Projects API
export const projectsApi = {
  getAll: async (): Promise<Project[]> => {
    const response = await api.get('/api/projects')
    if (Array.isArray(response.data)) {
      return response.data
    }
    return response.data?.projects ?? []
  },

  create: async (data: CreateProjectInput): Promise<Project> => {
    const response = await api.post('/api/projects', data)
    return response.data
  },

  update: async (id: string, data: Partial<CreateProjectInput>): Promise<Project> => {
    const response = await api.patch(`/api/projects/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/projects/${id}`)
  },

  getAgentsMd: async (id: string): Promise<ProjectAgentsMdResponse> => {
    const response = await api.get(`/api/projects/${id}/agents-md`)
    return response.data
  },

  updateAgentsMd: async (id: string, content: string): Promise<ProjectAgentsMdResponse> => {
    const response = await api.put(`/api/projects/${id}/agents-md`, { content })
    return response.data
  },
}

// Tasks API
export const tasksApi = {
  getByProject: async (projectId: string, includeSubtasks = true): Promise<Task[]> => {
    const response = await api.get(`/api/tasks`, {
      params: { project_id: projectId, include_subtasks: includeSubtasks ? 1 : 0 }
    })
    // Backend returns {tasks: [], total: 0} or direct array
    if (Array.isArray(response.data)) {
      return response.data
    }
    return response.data?.tasks ?? []
  },

  getById: async (id: string): Promise<Task> => {
    const response = await api.get(`/api/tasks/${id}`)
    return response.data
  },

  getContext: async (id: string): Promise<TaskContext> => {
    const response = await api.get(`/api/tasks/${id}/context`, {
      params: { include_comments: 0 },
    })
    return response.data
  },

  getSubtasks: async (id: string): Promise<Task[]> => {
    const response = await api.get(`/api/tasks/${id}/subtasks`)
    return response.data
  },

  create: async (data: CreateTaskInput): Promise<Task> => {
    const response = await api.post('/api/tasks', data)
    return response.data
  },

  update: async (id: string, data: UpdateTaskInput): Promise<Task> => {
    const response = await api.patch(`/api/tasks/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/tasks/${id}`)
  },

  transition: async (id: string, data: TransitionTaskInput): Promise<Task> => {
    const response = await api.post(`/api/tasks/${id}/transition`, data)
    return response.data
  },

  approveQa: async (id: string, data: ApproveQaInput): Promise<Task> => {
    const response = await api.post(`/api/tasks/${id}/approve_qa`, data)
    return response.data
  },

  getMetrics: async (): Promise<Record<string, number>> => {
    const response = await api.get('/api/tasks/metrics')
    return response.data
  },

  getQaEvidence: async (id: string): Promise<QaEvidenceEntry[]> => {
    const response = await api.get(`/api/tasks/${id}/qa-evidence`)
    if (Array.isArray(response.data)) {
      return response.data as QaEvidenceEntry[]
    }
    return (response.data?.evidence || []) as QaEvidenceEntry[]
  },

  getQaEvidenceScreenshotUrl: (taskId: string, evidenceId: string, index: number): string => {
    return `${API_BASE_URL}/api/tasks/${taskId}/qa-evidence/${evidenceId}/screenshots/${index}`
  },
}

// Comments API
export const commentsApi = {
  getByTask: async (
    taskId: string,
    params?: { limit?: number; offset?: number; order?: 'asc' | 'desc' }
  ): Promise<TaskCommentsPage> => {
    const response = await api.get(`/api/tasks/${taskId}/comments`, {
      params,
    })

    if (Array.isArray(response.data)) {
      const comments = response.data as TaskComment[]
      return {
        comments,
        total: comments.length,
        limit: comments.length,
        offset: 0,
        has_more: false,
        next_offset: null,
      }
    }

    const comments = (response.data?.comments ?? []) as TaskComment[]
    const total = Number(response.data?.total ?? comments.length)
    const limit = Number(response.data?.limit ?? comments.length)
    const offset = Number(response.data?.offset ?? 0)
    const hasMore = Boolean(response.data?.has_more)
    const nextOffsetRaw = response.data?.next_offset
    const nextOffset = nextOffsetRaw == null ? null : Number(nextOffsetRaw)

    return {
      comments,
      total,
      limit,
      offset,
      has_more: hasMore,
      next_offset: Number.isFinite(nextOffset as number) ? nextOffset : null,
    }
  },

  create: async (taskId: string, data: CreateCommentInput): Promise<TaskComment> => {
    const response = await api.post(`/api/tasks/${taskId}/comments`, data)
    return response.data
  },
}

// Workflow API
export const workflowApi = {
  runCycle: async (): Promise<{ processed: number }> => {
    const response = await api.post('/api/workflow/run-cycle')
    return response.data
  },
}

export const activityApi = {
  getLive: async (filters?: { project_id?: string; task_id?: string }): Promise<Activity[]> => {
    const response = await api.get('/api/activity/live', {
      params: {
        project_id: filters?.project_id,
        task_id: filters?.task_id,
      },
    })
    if (Array.isArray(response.data)) {
      return response.data as Activity[]
    }
    return (response.data?.activities || []) as Activity[]
  },
}

// Agents API
export const agentsApi = {
  getAll: async (): Promise<AgentsCatalogResponse> => {
    const response = await api.get('/api/agents')
    return response.data as AgentsCatalogResponse
  },

  getById: async (id: string): Promise<Agent> => {
    const response = await api.get(`/api/agents/${id}`)
    return response.data
  },

  create: async (data: Omit<Agent, 'id'>): Promise<Agent> => {
    const response = await api.post('/api/agents', data)
    return response.data
  },

  heartbeat: async (id: string): Promise<void> => {
    await api.post(`/api/agents/${id}/heartbeat`)
  },

  chat: async (id: string, message: string): Promise<{ response: string }> => {
    const response = await api.post(`/api/agents/${id}/chat`, { message })
    return response.data
  },
}

// Health check
export const healthApi = {
  check: async (): Promise<{ status: string }> => {
    const response = await api.get('/health')
    return response.data
  },
}

export const settingsApi = {
  getAll: async (): Promise<Record<string, unknown>> => {
    const response = await api.get('/api/settings')
    return response.data ?? {}
  },

  getProvider: async (): Promise<ProviderSettings> => {
    const response = await api.get('/api/settings/provider')
    return response.data
  },

  getProviderCapabilities: async (): Promise<ProviderCapabilitiesResponse> => {
    const response = await api.get('/api/settings/provider/capabilities')
    return response.data
  },

  getProviderModels: async (provider?: ProviderSettings['provider']): Promise<ProviderModelsResponse> => {
    const response = await api.get('/api/settings/provider/models', {
      params: provider ? { provider } : undefined,
    })
    return response.data
  },

  testProvider: async (provider?: ProviderSettings['provider']): Promise<ProviderTestResponse> => {
    const response = await api.post('/api/settings/provider/test', {
      provider,
    })
    return response.data
  },

  getProviderHealth: async (): Promise<ProviderHealthResponse> => {
    const response = await api.get('/api/settings/provider/health')
    return response.data
  },

  update: async (key: string, value: unknown): Promise<{ key: string; value: unknown }> => {
    const response = await api.patch(`/api/settings/${key}`, { value })
    return response.data
  },
}

export default api
