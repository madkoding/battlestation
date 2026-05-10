import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, FolderOpen, ChevronRight, CheckCircle2, Trash2, Settings, AlertTriangle, RotateCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, AnimatedPage } from '@/components/common/LoadingSpinner'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import type { Project } from '@/types/models'
import { cn } from '@/lib/utils'
import { projectsApi, tasksApi, workflowApi } from '@/lib/api'

// Project Card Component
function ProjectCard({
  project,
  index,
  onRequestDelete,
  onOpenSettings,
  isDeleting,
}: {
  project: Project
  index: number
  onRequestDelete: (project: Project) => void
  onOpenSettings: (project: Project) => void
  isDeleting: boolean
}) {
  const { openKanbanModal } = useUIStore()
  const { addToast } = useToastStore()

  const handleClick = () => {
    if (typeof performance !== 'undefined') {
      performance.mark(`kanban-open-click:${project.id}`)
    }
    openKanbanModal(project.id)
    addToast('info', `Opened Kanban board for ${project.name}`)
  }

  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRequestDelete(project)
  }

  const handleSettingsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenSettings(project)
  }
  
  // Generate gradient based on project color or default
  const gradientColors = [
    'from-accent-primary/20 to-accent-secondary/20',
    'from-accent-secondary/20 to-accent-tertiary/20',
    'from-accent-tertiary/20 to-accent-primary/20',
    'from-status-progress/20 to-accent-primary/20',
  ]
  const gradient = gradientColors[index % gradientColors.length]
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Card
        onClick={handleClick}
        className={cn(
          "group cursor-pointer overflow-hidden",
          "border-border-default bg-bg-card hover:border-accent-primary/50",
          "transition-all duration-300 hover:shadow-glow"
        )}
      >
        {/* Gradient header - compact on mobile */}
        <div className={cn(
          "h-16 sm:h-20 tablet:h-24 bg-gradient-to-br relative overflow-hidden",
          gradient
        )}>
          {project.banner_image_url ? (
            <img
              src={project.banner_image_url}
              alt={`${project.name} banner`}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xKSIvPjwvc3ZnPg==')] opacity-30" />
          
          {/* Floating icon - smaller on mobile */}
          <motion.div 
            className="absolute top-3 right-3 sm:top-4 sm:right-4 w-9 h-9 sm:w-10 sm:h-10 tablet:w-12 tablet:h-12 rounded-xl bg-bg-card/80 backdrop-blur-sm flex items-center justify-center border border-border-default"
            whileHover={{ rotate: 10 }}
          >
            <FolderOpen className="h-4 w-4 sm:h-5 sm:w-5 tablet:h-6 tablet:w-6 text-accent-primary" />
          </motion.div>
        </div>
        
        {/* Content */}
        <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-text-primary group-hover:text-accent-primary transition-colors line-clamp-1">
                {project.name}
              </h3>
              <p className="text-xs text-text-muted line-clamp-1 mt-1">
                {project.path}
              </p>
            </div>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-muted hover:text-accent-primary"
                onClick={handleSettingsClick}
                aria-label={`Open settings for ${project.name}`}
              >
                <Settings className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-muted hover:text-accent-danger"
                onClick={handleDeleteClick}
                disabled={isDeleting}
                aria-label={`Delete project ${project.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Stats */}
          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <CheckCircle2 className="h-3.5 w-3.5 text-status-done" />
              <span>{project.task_count || 0} tasks</span>
            </div>
            
            <motion.div 
              className="flex items-center gap-1 text-xs text-accent-primary ml-auto"
              whileHover={{ x: 4 }}
            >
              <span>Open</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </motion.div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

// Project Grid
function ProjectGrid({
  onRequestDelete,
  onOpenSettings,
  deletingProjectId,
}: {
  onRequestDelete: (project: Project) => void
  onOpenSettings: (project: Project) => void
  deletingProjectId: string | null
}) {
  const { projects, isLoadingProjects } = useProjectStore()
  const { dashboardQuery } = useUIStore()
  
  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(dashboardQuery.toLowerCase()) ||
    p.path.toLowerCase().includes(dashboardQuery.toLowerCase())
  )
  
  if (isLoadingProjects) {
    return (
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="h-40 sm:h-44 tablet:h-48 animate-pulse bg-surface-default/50" />
        ))}
      </div>
    )
  }
  
  if (filteredProjects.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen className="h-12 w-12" />}
        title="No projects found"
        description={dashboardQuery ? "Try adjusting your search terms" : "Create your first project to get started"}
      />
    )
  }
  
  return (
    <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
      {filteredProjects.map((project, index) => (
        <ProjectCard
          key={project.id}
          project={project}
          index={index}
          onRequestDelete={onRequestDelete}
          onOpenSettings={onOpenSettings}
          isDeleting={deletingProjectId === project.id}
        />
      ))}
    </div>
  )
}

// Stats Overview
function StatsOverview({
  projectCount,
  metrics,
  isLoading,
}: {
  projectCount: number
  metrics: Record<string, number> | null
  isLoading: boolean
}) {
  const safeMetrics = metrics || {}

  const stats = [
    { label: 'Projects', value: projectCount, icon: FolderOpen, color: 'text-accent-primary' },
    { label: 'Todo', value: Number(safeMetrics.todo || 0), icon: CheckCircle2, color: 'text-text-muted' },
    { label: 'Progress', value: Number(safeMetrics.progress || 0), icon: RotateCw, color: 'text-status-progress' },
    { label: 'QA', value: Number(safeMetrics.qa || 0), icon: CheckCircle2, color: 'text-status-qa' },
    { label: 'Escalations', value: Number(safeMetrics.escalations || 0), icon: AlertTriangle, color: 'text-warning' },
    { label: 'Requeues', value: Number(safeMetrics.requeues || 0), icon: RotateCw, color: 'text-accent-secondary' },
  ]
  
  return (
    <div className="grid grid-cols-2 tablet:grid-cols-3 gap-2 sm:gap-3 tablet:gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-2.5 sm:p-3 tablet:p-4 border-border-default">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={cn("p-1.5 sm:p-2 rounded-lg bg-surface-default shrink-0", stat.color)}>
              <stat.icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl tablet:text-2xl font-bold text-text-primary">
                {isLoading ? '...' : stat.value}
              </p>
              <p className="text-[10px] sm:text-xs text-text-muted">{stat.label}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) {
            resetCreateForm()
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Create Project</DialogTitle>
          </DialogHeader>

          <form className="space-y-3" onSubmit={handleCreateProject}>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Project name"
              autoFocus
              required
            />
            <Input
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setIsPathEdited(true)
              }}
              placeholder="/path/to/project"
              required
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsCreateOpen(false)
                  resetCreateForm()
                }}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || !name.trim() || !path.trim()}>
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(projectPendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingProjectId) {
            setProjectPendingDelete(null)
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Delete Project</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Delete <span className="font-semibold text-text-primary">{projectPendingDelete?.name}</span> from Battlestation?
            </p>
            <p className="text-xs text-text-muted">
              This only removes the project from Battlestation and does not delete project folders or files.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setProjectPendingDelete(null)}
                disabled={Boolean(deletingProjectId)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteProject}
                disabled={Boolean(deletingProjectId)}
              >
                {deletingProjectId ? 'Deleting...' : 'Delete project'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isSettingsOpen}
        onOpenChange={(open) => {
          setIsSettingsOpen(open)
          if (!open) {
            setSettingsProject(null)
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Project Settings{settingsProject ? ` · ${settingsProject.name}` : ''}
            </DialogTitle>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSaveProjectSettings}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Title</label>
              <Input
                value={settingsName}
                onChange={(e) => setSettingsName(e.target.value)}
                placeholder="Project title"
                required
                disabled={isLoadingSettings || isSavingSettings}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Description</label>
              <Textarea
                value={settingsDescription}
                onChange={(e) => setSettingsDescription(e.target.value)}
                placeholder="What is this project about?"
                rows={4}
                disabled={isLoadingSettings || isSavingSettings}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Banner Image URL</label>
              <Input
                value={settingsBanner}
                onChange={(e) => setSettingsBanner(e.target.value)}
                placeholder="https://..."
                disabled={isLoadingSettings || isSavingSettings}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">AGENTS.md</label>
              <Textarea
                value={agentsMd}
                onChange={(e) => setAgentsMd(e.target.value)}
                placeholder="Project context and instructions for AI agents"
                rows={16}
                disabled={isLoadingSettings || isSavingSettings}
              />
              <p className="text-xs text-text-muted">
                AGENTS.md defines project context for your configured agent profiles. If missing, the orchestrator profile creates it automatically.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsSettingsOpen(false)}
                disabled={isSavingSettings}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoadingSettings || isSavingSettings || !settingsName.trim()}>
                {isSavingSettings ? 'Saving...' : 'Save settings'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  )
}
