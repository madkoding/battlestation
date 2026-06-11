import { useCallback, useEffect, useState } from 'react'
import { Plus, RotateCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedPage } from '@/components/common/LoadingSpinner'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import type { Project } from '@/types/models'
import { cn } from '@/lib/utils'
import { projectsApi, tasksApi, workflowApi } from '@/lib/api'
import { StatsOverview } from './StatsOverview'
import { ProjectGrid } from './ProjectGrid'
import { ProjectDialogs } from './ProjectDialogs'

// Main Dashboard View
export function DashboardView() {
  const { loadProjects, projects } = useProjectStore()
  const { kanbanModal, closeKanbanModal } = useUIStore()
  const { addToast } = useToastStore()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [isPathEdited, setIsPathEdited] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [projectPendingDelete, setProjectPendingDelete] = useState<Project | null>(null)
  const [settingsProject, setSettingsProject] = useState<Project | null>(null)
  const [settingsName, setSettingsName] = useState('')
  const [settingsDescription, setSettingsDescription] = useState('')
  const [settingsBanner, setSettingsBanner] = useState('')
  const [agentsMd, setAgentsMd] = useState('')
  const [isLoadingSettings, setIsLoadingSettings] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [taskMetrics, setTaskMetrics] = useState<Record<string, number> | null>(null)
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false)
  const [isRunningCycle, setIsRunningCycle] = useState(false)

  const loadTaskMetrics = useCallback(async () => {
    setIsLoadingMetrics(true)
    try {
      const metrics = await tasksApi.getMetrics()
      setTaskMetrics(metrics)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load dashboard metrics'
      addToast('error', message)
    } finally {
      setIsLoadingMetrics(false)
    }
  }, [addToast])

  const slugify = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const resetCreateForm = () => {
    setName('')
    setPath('')
    setIsPathEdited(false)
  }

  const handleNameChange = (value: string) => {
    setName(value)
    if (!isPathEdited) {
      const slug = slugify(value)
      setPath(slug ? `/path/to/${slug}` : '')
    }
  }

  const handleCreateProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedPath = path.trim()

    if (!trimmedName || !trimmedPath || isCreating) {
      return
    }

    setIsCreating(true)

    try {
      await projectsApi.create({
        name: trimmedName,
        path: trimmedPath,
      })
      await loadProjects()
      await loadTaskMetrics()
      setIsCreateOpen(false)
      resetCreateForm()
      addToast('success', `Project ${trimmedName} created`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create project'
      addToast('error', message)
    } finally {
      setIsCreating(false)
    }
  }

  const requestDeleteProject = (project: Project) => {
    if (deletingProjectId) {
      return
    }
    setProjectPendingDelete(project)
  }

  const handleDeleteProject = async () => {
    if (!projectPendingDelete) {
      return
    }

    const project = projectPendingDelete
    if (deletingProjectId) {
      return
    }

    setDeletingProjectId(project.id)

    try {
      await projectsApi.delete(project.id)
      if (kanbanModal?.projectId === project.id) {
        closeKanbanModal()
      }
      await loadProjects()
      await loadTaskMetrics()
      addToast('success', `Project ${project.name} removed from Battlestation`)
      setProjectPendingDelete(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete project'
      addToast('error', message)
    } finally {
      setDeletingProjectId(null)
    }
  }

  const openProjectSettings = async (project: Project) => {
    setSettingsProject(project)
    setSettingsName(project.name || '')
    setSettingsDescription(project.description || '')
    setSettingsBanner(project.banner_image_url || '')
    setAgentsMd('')
    setIsSettingsOpen(true)
    setIsLoadingSettings(true)

    try {
      const agents = await projectsApi.getAgentsMd(project.id)
      setAgentsMd(agents.content || '')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load AGENTS.md'
      addToast('error', message)
    } finally {
      setIsLoadingSettings(false)
    }
  }

  const handleSaveProjectSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settingsProject || isSavingSettings) {
      return
    }

    const trimmedName = settingsName.trim()
    if (!trimmedName) {
      addToast('error', 'Project title is required')
      return
    }

    setIsSavingSettings(true)
    try {
      await projectsApi.update(settingsProject.id, {
        name: trimmedName,
        description: settingsDescription.trim(),
        banner_image_url: settingsBanner.trim(),
      })

      await projectsApi.updateAgentsMd(settingsProject.id, agentsMd)
      await loadProjects()
      await loadTaskMetrics()
      addToast('success', `Project ${trimmedName} settings saved`)
      setIsSettingsOpen(false)
      setSettingsProject(null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save project settings'
      addToast('error', message)
    } finally {
      setIsSavingSettings(false)
    }
  }

  const handleRunCycle = async () => {
    if (isRunningCycle) return
    setIsRunningCycle(true)
    try {
      const result = await workflowApi.runCycle()
      await loadProjects()
      await loadTaskMetrics()
      if (Number(result.processed || 0) > 0) {
        addToast('success', 'Workflow cycle started')
      } else {
        addToast('info', 'Workflow already running')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to run workflow cycle'
      addToast('error', message)
    } finally {
      setIsRunningCycle(false)
    }
  }
  
  useEffect(() => {
    void loadProjects()
    const initial = window.setTimeout(() => {
      void loadTaskMetrics()
    }, 0)
    const timer = window.setInterval(() => {
      void loadTaskMetrics()
    }, 10000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [loadProjects, loadTaskMetrics])
  
  return (
    <AnimatedPage className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-xs sm:text-sm text-text-muted">Manage your projects and tasks</p>
        </div>
      </div>
      
      {/* Stats */}
      <StatsOverview
        projectCount={projects.length}
        metrics={taskMetrics}
        isLoading={isLoadingMetrics}
      />
      
      {/* Main Content Grid */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 gap-4 sm:gap-6">
        {/* Projects Section */}
        <div className="tablet:col-span-2 space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-semibold text-text-primary">Projects</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 sm:h-9"
                onClick={handleRunCycle}
                disabled={isRunningCycle}
              >
                <RotateCw className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1', isRunningCycle && 'animate-spin')} />
                <span className="text-xs sm:text-sm">Run cycle</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 sm:h-9"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
                <span className="text-xs sm:text-sm">New</span>
              </Button>
            </div>
          </div>
          
          <ProjectGrid
            onRequestDelete={requestDeleteProject}
            onOpenSettings={openProjectSettings}
            deletingProjectId={deletingProjectId}
          />
        </div>
        
        {/* Sidebar */}
        <div className="space-y-3 sm:space-y-4">
          <Card className="border-border-default p-4 text-sm text-text-muted">
            Create tasks from each project board.
          </Card>
        </div>
      </div>

      <ProjectDialogs
        isCreateOpen={isCreateOpen}
        setIsCreateOpen={setIsCreateOpen}
        name={name}
        handleNameChange={handleNameChange}
        path={path}
        setPath={setPath}
        setIsPathEdited={setIsPathEdited}
        isCreating={isCreating}
        handleCreateProject={handleCreateProject}
        resetCreateForm={resetCreateForm}
        projectPendingDelete={projectPendingDelete}
        setProjectPendingDelete={setProjectPendingDelete}
        deletingProjectId={deletingProjectId}
        handleDeleteProject={handleDeleteProject}
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        setSettingsProject={setSettingsProject}
        settingsProject={settingsProject}
        settingsName={settingsName}
        setSettingsName={setSettingsName}
        settingsDescription={settingsDescription}
        setSettingsDescription={setSettingsDescription}
        settingsBanner={settingsBanner}
        setSettingsBanner={setSettingsBanner}
        agentsMd={agentsMd}
        setAgentsMd={setAgentsMd}
        isLoadingSettings={isLoadingSettings}
        isSavingSettings={isSavingSettings}
        handleSaveProjectSettings={handleSaveProjectSettings}
      />
    </AnimatedPage>
  )
}
