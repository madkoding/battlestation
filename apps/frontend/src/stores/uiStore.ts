import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { Theme } from '@/lib/constants'

interface ModalFrame {
  type: 'task' | 'subtask'
  taskId: string
}

interface KanbanModalFrame {
  projectId: string
}

interface UIState {
  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // Density
  density: 'normal' | 'compact'
  densityMode: 'auto' | 'manual'
  setDensity: (density: 'normal' | 'compact') => void
  setDensityMode: (mode: 'auto' | 'manual') => void

  // CRT Effect
  crtFx: 'on' | 'off'
  setCrtFx: (value: 'on' | 'off') => void

  // Modals - stack for task -> subtask navigation
  modalStack: ModalFrame[]
  openTaskModal: (taskId: string) => void
  openSubtaskModal: (taskId: string) => void
  closeModal: () => void
  closeAllModals: () => void
  canGoBack: () => boolean

  // Kanban Modal
  kanbanModal: KanbanModalFrame | null
  isKanbanModalOpen: boolean
  openKanbanModal: (projectId: string) => void
  closeKanbanModal: () => void

  // Settings panel
  isSettingsOpen: boolean
  setSettingsOpen: (open: boolean) => void

  // Live activity modal
  isLiveActivityOpen: boolean
  setLiveActivityOpen: (open: boolean) => void

  // Quick create
  isQuickCreateOpen: boolean
  setQuickCreateOpen: (open: boolean) => void

  // Search
  dashboardQuery: string
  projectQuery: string
  kanbanStatus: string
  setDashboardQuery: (query: string) => void
  setProjectQuery: (query: string) => void
  setKanbanStatus: (status: string) => void

  // WebSocket connection state
  wsConnectionState: 'connecting' | 'connected' | 'reconnecting' | 'offline'
  setWsConnectionState: (state: 'connecting' | 'connected' | 'reconnecting' | 'offline') => void
  wsLastError: string | null
  wsLastConnectedAt: string | null
  setWsLastError: (message: string | null) => void
  setWsLastConnectedAt: (isoTimestamp: string | null) => void
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set, get) => ({
        // Theme
        theme: 'cyber-dark',
        setTheme: (theme) => {
          document.documentElement.setAttribute('data-theme', theme)
          set({ theme })
        },

        // Density
        density: 'normal',
        densityMode: 'auto',
        setDensity: (density) => set({ density }),
        setDensityMode: (densityMode) => set({ densityMode }),

        // CRT
        crtFx: 'off',
        setCrtFx: (crtFx) => set({ crtFx }),

        // Modals
        modalStack: [],
        openTaskModal: (taskId) => {
          const { modalStack } = get()
          set({
            modalStack: [...modalStack, { type: 'task', taskId }]
          })
        },
        openSubtaskModal: (taskId) => {
          const { modalStack } = get()
          set({
            modalStack: [...modalStack, { type: 'subtask', taskId }]
          })
        },
        closeModal: () => {
          const { modalStack } = get()
          const newStack = modalStack.slice(0, -1)
          set({ modalStack: newStack })
        },
        closeAllModals: () => set({ modalStack: [] }),
        canGoBack: () => get().modalStack.length > 1,

        // Kanban Modal
        kanbanModal: null,
        isKanbanModalOpen: false,
        openKanbanModal: (projectId) => {
          set({
            kanbanModal: { projectId },
            isKanbanModalOpen: true
          })
        },
        closeKanbanModal: () => {
          set({
            kanbanModal: null,
            isKanbanModalOpen: false
          })
        },

        // Settings
        isSettingsOpen: false,
        setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),

        // Live activity
        isLiveActivityOpen: false,
        setLiveActivityOpen: (isLiveActivityOpen) => set({ isLiveActivityOpen }),

        // Quick create
        isQuickCreateOpen: false,
        setQuickCreateOpen: (isQuickCreateOpen) => set({ isQuickCreateOpen }),

        // Search
        dashboardQuery: '',
        projectQuery: '',
        kanbanStatus: 'all',
        setDashboardQuery: (dashboardQuery) => set({ dashboardQuery }),
        setProjectQuery: (projectQuery) => set({ projectQuery }),
        setKanbanStatus: (kanbanStatus) => set({ kanbanStatus }),

        wsConnectionState: 'connecting',
        setWsConnectionState: (wsConnectionState) => set({ wsConnectionState }),
        wsLastError: null,
        wsLastConnectedAt: null,
        setWsLastError: (wsLastError) => set({ wsLastError }),
        setWsLastConnectedAt: (wsLastConnectedAt) => set({ wsLastConnectedAt }),
      }),
      {
        name: 'ui-store',
        partialize: (state) => ({
          theme: state.theme,
          density: state.density,
          densityMode: state.densityMode,
          crtFx: state.crtFx,
        }),
        onRehydrateStorage: () => (state) => {
          if (state) {
            document.documentElement.setAttribute('data-theme', state.theme)
          }
        },
      }
    ),
    { name: 'ui-store' }
  )
)
