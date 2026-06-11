import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { agentsApi } from '@/lib/api'
import type { AgentProfile, AgentWorkflow } from '@/types/models'

const DEFAULT_WORKFLOW: AgentWorkflow = {
  roles: {
    orchestrator: 'Orchestrator Agent',
    developer: 'Developer Agent',
    qa: 'QA Agent',
  },
  status_owners: {
    todo: 'Orchestrator Agent',
    progress: 'Developer Agent',
    qa: 'QA Agent',
    done: 'Orchestrator Agent',
  },
  transition_owners: {
    'todo:progress': 'Orchestrator Agent',
    'progress:qa': 'Developer Agent',
    'qa:progress': 'QA Agent',
    'qa:done': 'Orchestrator Agent',
  },
}

interface AgentState {
  profiles: AgentProfile[]
  workflow: AgentWorkflow
  isLoading: boolean
  loadCatalog: () => Promise<void>
  getStatusOwner: (status: string) => string
  getTransitionOwner: (from: string, to: string) => string
  getAgentRole: (name: string) => string
}

export const useAgentStore = create<AgentState>()(
  devtools(
    (set, get) => ({
      profiles: [],
      workflow: DEFAULT_WORKFLOW,
      isLoading: false,

      loadCatalog: async () => {
        set({ isLoading: true })
        try {
          const data = await agentsApi.getAll()
          set({
            profiles: data?.profiles || [],
            workflow: data?.workflow || DEFAULT_WORKFLOW,
            isLoading: false,
          })
        } catch (error: unknown) {
          console.error('Failed to load agent catalog:', error)
          set({ isLoading: false })
        }
      },

      getStatusOwner: (status) => {
        const key = String(status || '').trim().toLowerCase()
        return get().workflow.status_owners[key] || ''
      },

      getTransitionOwner: (from, to) => {
        const key = `${String(from || '').trim().toLowerCase()}:${String(to || '').trim().toLowerCase()}`
        return get().workflow.transition_owners[key] || ''
      },

      getAgentRole: (name) => {
        const target = String(name || '').trim().toLowerCase()
        if (!target) return ''
        const profile = get().profiles.find((item) => item.name.trim().toLowerCase() === target)
        return profile?.role || ''
      },
    }),
    { name: 'agent-store' }
  )
)
