import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import type { Project } from '@/types/models'
import { projectsApi, tasksApi, workflowApi } from '@/lib/api'
import { METRICS_POLL_MS } from '@/lib/constants'

export function useProjectActions() {
  const { loadProjects, projects } = useProjectStore()
  const { kanbanModal, closeKanbanModal } = useUIStore()
  const { addToast } = useToastStore()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const isPathEditedRef = useRef(false)
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

  const resetCreateForm = useCallback(() => {
    setName('')
    setPath('')
    isPathEditedRef.current = false
  }, [])

  const handleNameChange = useCallback((value: string) => {
    setName(value)
    if (!isPathEditedRef.current) {
      const slug = slugify(value)
      setPath(slug ? `/path/to/${slug}` : '')
    }
  }, [])

  const handleCreateProject = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedPath = path.trim()

    if (!trimmedName || !trimmedPath || isCreating) {
      return
    }

    setIsCreating(true)

    try {
      await projectsApi.create({ name: trimmedName, path: trimmedPath })
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
  }, [name, path, isCreating, loadProjects, loadTaskMetrics, resetCreateForm, addToast])

  const requestDeleteProject = useCallback((project: Project) => {
    if (deletingProjectId) return
    setProjectPendingDelete(project)
  }, [deletingProjectId])

  const handleDeleteProject = useCallback(async () => {
    if (!projectPendingDelete || deletingProjectId) return

    const project = projectPendingDelete
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
  }, [projectPendingDelete, deletingProjectId, kanbanModal, closeKanbanModal, loadProjects, loadTaskMetrics, addToast])

  const openProjectSettings = useCallback(async (project: Project) => {
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
  }, [addToast])

  const handleSaveProjectSettings = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settingsProject || isSavingSettings) return

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
  }, [settingsProject, isSavingSettings, settingsName, settingsDescription, settingsBanner, agentsMd, loadProjects, loadTaskMetrics, addToast])

  const handleRunCycle = useCallback(async () => {
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
  }, [isRunningCycle, loadProjects, loadTaskMetrics, addToast])

  useEffect(() => {
    void loadProjects()
    const initial = window.setTimeout(() => {
      void loadTaskMetrics()
    }, 0)
    const timer = window.setInterval(() => {
      void loadTaskMetrics()
    }, METRICS_POLL_MS)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [loadProjects, loadTaskMetrics])

  return {
    projects,
    isCreateOpen,
    setIsCreateOpen,
    name,
    handleNameChange,
    path,
    setPath,
    isCreating,
    handleCreateProject,
    resetCreateForm,
    projectPendingDelete,
    setProjectPendingDelete,
    deletingProjectId,
    requestDeleteProject,
    handleDeleteProject,
    isSettingsOpen,
    setIsSettingsOpen,
    setSettingsProject,
    settingsProject,
    settingsName,
    setSettingsName,
    settingsDescription,
    setSettingsDescription,
    settingsBanner,
    setSettingsBanner,
    agentsMd,
    setAgentsMd,
    isLoadingSettings,
    isSavingSettings,
    openProjectSettings,
    handleSaveProjectSettings,
    taskMetrics,
    isLoadingMetrics,
    isRunningCycle,
    handleRunCycle,
  }
}
