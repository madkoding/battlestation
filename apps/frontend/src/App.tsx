import { lazy, Suspense, useEffect, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

const LandingPage = lazy(() =>
  import('@/components/landing/LandingPage').then((m) => ({ default: m.LandingPage })),
)
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import { useAgentStore } from '@/stores/agentStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { healthApi } from '@/lib/api'

const LiveActivityModal = lazy(() =>
  import('@/components/dashboard/LiveActivityModal').then((m) => ({ default: m.LiveActivityModal })),
)
const TaskModal = lazy(() =>
  import('@/components/task/TaskModal').then((m) => ({ default: m.TaskModal })),
)
const KanbanModal = lazy(() =>
  import('@/components/kanban/KanbanModal').then((m) => ({ default: m.KanbanModal })),
)

function ModalFallback() {
  return null
}

function AppDashboard() {
  const { loadProjects } = useProjectStore()
  const { loadCatalog } = useAgentStore()
  const { theme } = useUIStore()
  const { addToast } = useToastStore()
  const bootstrappedRef = useRef(false)

  // Initialize WebSocket
  useWebSocket()

  // Initialize app
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    // Check API health
    healthApi.check()
      .then(() => {
        addToast('success', 'Connected to Battlestation API')
      })
      .catch(() => {
        addToast('error', 'Could not connect to Battlestation API')
      })

    // Load projects
    loadProjects()
    loadCatalog()

    // Initialize theme
    document.documentElement.setAttribute('data-theme', theme)
  }, [addToast, loadProjects, loadCatalog, theme])

  return (
    <ErrorBoundary>
      <AppShell>
        <DashboardView />

        <ErrorBoundary>
          <Suspense fallback={<ModalFallback />}>
            <LiveActivityModal />
            <TaskModal />
            <KanbanModal />
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </ErrorBoundary>
  )
}

// Main App Component
function App() {
  const isPagesLanding = import.meta.env.PROD && window.location.hostname.endsWith('github.io')
  return isPagesLanding ? <Suspense fallback={null}><LandingPage /></Suspense> : <AppDashboard />
}

export default App
