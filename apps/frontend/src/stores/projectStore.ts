import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Project, Task, TaskContext } from '@/types/models'
import { TRANSITION_CONFIG, type TaskStatus } from '@/lib/constants'
import { projectsApi, tasksApi } from '@/lib/api'
import { useAgentStore } from '@/stores/agentStore'

interface ProjectState {
  // Data
  projects: Project[]
  selectedProjectId: string | null
  projectTasks: Record<string, Task[]>
  taskContexts: Record<string, TaskContext>
  taskCommentsVersion: Record<string, number>
  
  // Loading states
  isLoadingProjects: boolean
  isLoadingTasks: boolean
  isLoadingContext: boolean
  
  // Error states
  projectsLoadError: string | null
  
  // Actions
  setProjects: (projects: Project[]) => void
  setSelectedProject: (id: string | null) => void
  loadProjects: () => Promise<void>
  loadProjectTasks: (projectId: string) => Promise<void>
  loadTaskContext: (taskId: string) => Promise<void>
  refreshTaskById: (taskId: string, options?: { includeContext?: boolean }) => Promise<void>
  bumpTaskCommentsVersion: (taskId: string) => void
  createTask: (projectId: string, title: string, description?: string, priority?: string) => Promise<Task | null>
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
  moveTask: (
    taskId: string,
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    transitionData?: {
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
  ) => Promise<void>
  refreshProject: (projectId: string) => Promise<void>
  
  // Helpers
  getProjectById: (id: string) => Project | undefined
  getTaskById: (id: string) => Task | undefined
  getTasksByStatus: (projectId: string, status: TaskStatus) => Task[]
}

export const useProjectStore = create<ProjectState>()(
  devtools(
    (set, get) => ({
      // Initial state
      projects: [],
      selectedProjectId: null,
      projectTasks: {},
      taskContexts: {},
      taskCommentsVersion: {},
      isLoadingProjects: false,
      isLoadingTasks: false,
      isLoadingContext: false,
      projectsLoadError: null,
      
      // Actions
      setProjects: (projects) => set({ projects }),
      
      setSelectedProject: (id) => set({ selectedProjectId: id }),
      
      loadProjects: async () => {
        set({ isLoadingProjects: true, projectsLoadError: null })
        try {
          const projects = await projectsApi.getAll()
          set({ projects, isLoadingProjects: false })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Failed to load projects'
          console.error(message, error)
          set({ isLoadingProjects: false, projectsLoadError: message })
        }
      },
      
      loadProjectTasks: async (projectId) => {
        set({ isLoadingTasks: true })
        try {
          const tasks = await tasksApi.getByProject(projectId)
          set((state) => ({
            projectTasks: { ...state.projectTasks, [projectId]: tasks },
            isLoadingTasks: false
          }))
        } catch (error: unknown) {
          console.error('Failed to load tasks:', error)
          set({ isLoadingTasks: false })
        }
      },
      
      loadTaskContext: async (taskId) => {
        set({ isLoadingContext: true })
        try {
          const context = await tasksApi.getContext(taskId)
          set((state) => ({
            taskContexts: { ...state.taskContexts, [taskId]: context },
            isLoadingContext: false
          }))
        } catch (error: unknown) {
          console.error('Failed to load task context:', error)
          set({ isLoadingContext: false })
        }
      },

      bumpTaskCommentsVersion: (taskId) => {
        if (!taskId) return
        set((state) => ({
          taskCommentsVersion: {
            ...state.taskCommentsVersion,
            [taskId]: (state.taskCommentsVersion[taskId] || 0) + 1,
          },
        }))
      },

      refreshTaskById: async (taskId, options) => {
        try {
          const includeContext = Boolean(options?.includeContext)
          const task = await tasksApi.getById(taskId)
          const context = includeContext ? await tasksApi.getContext(taskId) : null

          set((state) => {
            const projectId = String(task.project_id || '')
            const existing = state.projectTasks[projectId] || []
            const hasTask = existing.some((t) => t.id === taskId)
            const merged = hasTask
              ? existing.map((t) => (t.id === taskId ? { ...t, ...task } : t))
              : [...existing, task]

            const existingContext = state.taskContexts[taskId]
            const nextTaskContexts = { ...state.taskContexts }

            if (context) {
              nextTaskContexts[taskId] = context
            } else if (existingContext) {
              nextTaskContexts[taskId] = {
                ...existingContext,
                task: {
                  ...existingContext.task,
                  ...task,
                },
              }
            }

            return {
              projectTasks: {
                ...state.projectTasks,
                [projectId]: merged,
              },
              taskContexts: nextTaskContexts,
            }
          })
        } catch (error: unknown) {
          console.error('Failed to refresh task by id:', error)
        }
      },
      
      createTask: async (projectId, title, description, priority = 'medium') => {
        try {
          const task = await tasksApi.create({
            project_id: projectId,
            title,
            description,
            priority: priority as 'low' | 'medium' | 'high',
          })
          
          // Update local state
          set((state) => ({
            projectTasks: {
              ...state.projectTasks,
              [projectId]: [...(state.projectTasks[projectId] || []), task]
            }
          }))
          
          return task
        } catch (error: unknown) {
          console.error('Failed to create task:', error)
          return null
        }
      },
      
      updateTask: async (taskId, updates) => {
        try {
          await tasksApi.update(taskId, updates)
          
          // Update local state
          set((state) => {
            const newProjectTasks = { ...state.projectTasks }
            Object.keys(newProjectTasks).forEach((projectId) => {
              newProjectTasks[projectId] = newProjectTasks[projectId].map((task) =>
                task.id === taskId ? { ...task, ...updates } : task
              )
            })
            return { projectTasks: newProjectTasks }
          })
        } catch (error: unknown) {
          console.error('Failed to update task:', error)
        }
      },
      
      moveTask: async (taskId, fromStatus, toStatus, transitionData) => {
        try {
          // Optimistic update
          set((state) => {
            const newProjectTasks = { ...state.projectTasks }
            Object.keys(newProjectTasks).forEach((projectId) => {
              newProjectTasks[projectId] = newProjectTasks[projectId].map((task) =>
                task.id === taskId ? { ...task, status: toStatus } : task
              )
            })
            return { projectTasks: newProjectTasks }
          })
          
          // API call with deterministic transition metadata
          const transitionKey = `${fromStatus}:${toStatus}`
          const transitionMeta = TRANSITION_CONFIG[transitionKey]
          const transitionOwner = useAgentStore.getState().getTransitionOwner(fromStatus, toStatus)
          await tasksApi.transition(taskId, {
            to_status: toStatus,
            agent_name: transitionOwner || transitionMeta?.agent,
            comment_text: transitionData?.comment_text || transitionMeta?.comment,
            qa_checklist: transitionData?.qa_checklist,
            qa_rejection: transitionData?.qa_rejection,
          })
        } catch (error: unknown) {
          console.error('Failed to move task:', error)
          // Revert optimistic update
          set((state) => {
            const newProjectTasks = { ...state.projectTasks }
            Object.keys(newProjectTasks).forEach((projectId) => {
              newProjectTasks[projectId] = newProjectTasks[projectId].map((task) =>
                task.id === taskId ? { ...task, status: fromStatus } : task
              )
            })
            return { projectTasks: newProjectTasks }
          })
          throw error
        }
      },
      
      refreshProject: async (projectId) => {
        await get().loadProjectTasks(projectId)
      },
      
      // Helpers
      getProjectById: (id) => get().projects.find((p) => p.id === id),
      
      getTaskById: (id) => {
        for (const tasks of Object.values(get().projectTasks)) {
          const task = tasks.find((t) => t.id === id)
          if (task) return task
        }
        return undefined
      },
      
      getTasksByStatus: (projectId, status) => {
        const tasks = get().projectTasks[projectId] || []
        return tasks.filter((t) => t.status === status && t.task_kind === 'task')
      },
    }),
    { name: 'project-store' }
  )
)
