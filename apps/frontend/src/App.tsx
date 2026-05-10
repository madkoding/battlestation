import { useEffect, useRef } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { LiveActivityModal } from '@/components/dashboard/LiveActivityModal'
import { TaskModal } from '@/components/task/TaskModal'
import { KanbanModal } from '@/components/kanban/KanbanModal'
import { LandingPage } from '@/components/landing/LandingPage'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import { useAgentStore } from '@/stores/agentStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { healthApi } from '@/lib/api'

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
    <AppShell>
      <DashboardView />

      <LiveActivityModal />
      <TaskModal />
      <KanbanModal />
    </AppShell>
  )
}

// Main App Component
function App() {
  const isPagesLanding = import.meta.env.PROD && window.location.hostname.endsWith('github.io')
  return isPagesLanding ? <LandingPage /> : <AppDashboard />
}

export default App
