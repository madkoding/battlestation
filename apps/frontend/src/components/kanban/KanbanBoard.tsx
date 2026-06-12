import { useEffect, useState, useRef, type UIEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { AlertCircle, ClipboardList } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/LoadingSpinner'
import { useProjectStore } from '@/stores/projectStore'
import { useToastStore } from '@/stores/toastStore'
import { STATUSES, STATUS_META, DRAG_ACTIVATION_DISTANCE_PX, type TaskStatus } from '@/lib/constants'
import type { Task } from '@/types/models'
import { TaskCard } from './TaskCard'
import { KanbanColumn } from './KanbanColumn'
import { MobileNav } from './MobileNav'
import { CreateTaskDialog } from './CreateTaskDialog'

// Main Kanban Board
export function KanbanBoard() {
  const { selectedProjectId, projectTasks, createTask, moveTask, loadProjectTasks, isLoadingTasks } = useProjectStore()
  const { addToast } = useToastStore()
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [currentColumnIndex, setCurrentColumnIndex] = useState(0)
  const mobileScrollRef = useRef<HTMLDivElement | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [isCreatingTask, setIsCreatingTask] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const currentProjectTasks = selectedProjectId ? projectTasks[selectedProjectId] : undefined
  const isInitialLoading = isLoadingTasks && !currentProjectTasks

  useEffect(() => {
    if (!selectedProjectId) return
    if (currentProjectTasks) return
    setLoadError(null)
    void loadProjectTasks(selectedProjectId)
  }, [selectedProjectId, currentProjectTasks, loadProjectTasks])

  useEffect(() => {
    if (!selectedProjectId) return
    if (isLoadingTasks) return
    if (currentProjectTasks) return
    setLoadError('Failed to load tasks')
  }, [selectedProjectId, isLoadingTasks, currentProjectTasks])

  // Group tasks by status
  const tasksByStatus = STATUSES.reduce((acc, status) => {
    acc[status] = currentProjectTasks?.filter(
      (t) =>
        t.status === status &&
        t.task_kind === 'task'
    ) || []
    return acc
  }, {} as Record<TaskStatus, Task[]>)

  // Sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: DRAG_ACTIVATION_DISTANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const task = currentProjectTasks?.find((t) => t.id === active.id)
    if (task) {
      setActiveTask(task)
    }
  }

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const taskId = active.id as string
    const overId = over.id as string

    // Check if dropped over a column
    const overColumn = STATUSES.find((s) => s === overId)

    if (overColumn) {
      const task = currentProjectTasks?.find((t) => t.id === taskId)
      if (task && task.status !== overColumn) {
        try {
          await moveTask(taskId, task.status, overColumn)
          addToast('success', `Task moved to ${STATUS_META[overColumn].label}`)
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Transition failed'
          addToast('error', message)
        }
      }
    }
  }

  const goToColumn = (index: number) => {
    const bounded = Math.max(0, Math.min(index, STATUSES.length - 1))
    setCurrentColumnIndex(bounded)
    if (!mobileScrollRef.current) return
    const viewportWidth = mobileScrollRef.current.clientWidth
    mobileScrollRef.current.scrollTo({
      left: bounded * viewportWidth,
      behavior: 'smooth',
    })
  }

  // Navigation for mobile
  const scrollToColumn = (direction: 'left' | 'right') => {
    if (direction === 'left' && currentColumnIndex > 0) {
      goToColumn(currentColumnIndex - 1)
    } else if (direction === 'right' && currentColumnIndex < STATUSES.length - 1) {
      goToColumn(currentColumnIndex + 1)
    }
  }

  const handleMobileScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    if (!node.clientWidth) return
    const nextIndex = Math.round(node.scrollLeft / node.clientWidth)
    const bounded = Math.max(0, Math.min(nextIndex, STATUSES.length - 1))
    if (bounded !== currentColumnIndex) {
      setCurrentColumnIndex(bounded)
    }
  }

  const handleCreateTodoTask = async () => {
    setIsCreateModalOpen(true)
  }

  const resetCreateTaskForm = () => {
    setNewTaskTitle('')
    setNewTaskDescription('')
    setNewTaskPriority('medium')
  }

  const handleCreateTaskSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedProjectId) {
      addToast('error', 'No project selected')
      return
    }

    const title = newTaskTitle.trim()
    if (!title) return

    setIsCreatingTask(true)

    try {
      const createdTask = await createTask(
        selectedProjectId,
        title,
        newTaskDescription.trim() || undefined,
        newTaskPriority
      )

      if (createdTask) {
        addToast('success', 'Task created in Todo')
        setIsCreateModalOpen(false)
        resetCreateTaskForm()
      } else {
        addToast('error', 'Failed to create task')
      }
    } finally {
      setIsCreatingTask(false)
    }
  }

  const renderBoard = () => (
    <>
      <MobileNav
        currentColumnIndex={currentColumnIndex}
        goToColumn={goToColumn}
        scrollToColumn={scrollToColumn}
        tasksByStatus={tasksByStatus}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={mobileScrollRef}
          onScroll={handleMobileScroll}
          className="kanban-mobile-scroll md:hidden flex-1 overflow-x-auto overflow-y-hidden snap-x snap-mandatory touch-pan-x"
        >
          <div className="flex h-full">
            {STATUSES.map((status) => (
              <div key={status} className="w-full shrink-0 snap-start h-full p-2 sm:p-3 tablet:p-4">
                <KanbanColumn
                  status={status}
                  tasks={tasksByStatus[status]}
                  layout="carousel"
                  onCreateTodoTask={handleCreateTodoTask}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="hidden md:block xl:hidden flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-2 auto-rows-[minmax(0,1fr)] gap-3 h-full min-h-[38rem] p-3">
            {STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={tasksByStatus[status]}
                layout="grid"
                onCreateTodoTask={handleCreateTodoTask}
              />
            ))}
          </div>
        </div>

        <div className="hidden xl:flex flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 h-full w-full min-w-0 p-3">
            {STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={tasksByStatus[status]}
                layout="desktop"
                onCreateTodoTask={handleCreateTodoTask}
              />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 200 }}>
          {activeTask ? <TaskCard task={activeTask} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      <CreateTaskDialog
        isCreateModalOpen={isCreateModalOpen}
        setIsCreateModalOpen={setIsCreateModalOpen}
        newTaskTitle={newTaskTitle}
        setNewTaskTitle={setNewTaskTitle}
        newTaskDescription={newTaskDescription}
        setNewTaskDescription={setNewTaskDescription}
        newTaskPriority={newTaskPriority}
        setNewTaskPriority={setNewTaskPriority}
        isCreatingTask={isCreatingTask}
        handleCreateTaskSubmit={handleCreateTaskSubmit}
        resetCreateTaskForm={resetCreateTaskForm}
      />
    </>
  )

  if (isInitialLoading) {
    return (
      <div className="h-full flex flex-col p-3 space-y-3">
        <div className="hidden xl:flex gap-3 h-full">
          {STATUSES.map((status) => (
            <div key={status} className="flex-1 space-y-3">
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ))}
        </div>
        <div className="hidden md:block xl:hidden">
          <div className="grid grid-cols-2 gap-3">
            {STATUSES.map((status) => (
              <div key={status} className="space-y-3">
                <Skeleton className="h-5 w-24" />
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="md:hidden space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-center gap-2 p-4 m-3 rounded-lg border border-danger/40 bg-danger/10 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              if (!selectedProjectId) return
              setLoadError(null)
              void loadProjectTasks(selectedProjectId)
            }}
            className="ml-auto underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (currentProjectTasks && currentProjectTasks.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <EmptyState
          icon={<ClipboardList className="h-12 w-12" />}
          title="No tasks yet"
          description="Create your first task to get started"
          action={
            <button
              type="button"
              onClick={handleCreateTodoTask}
              className="px-4 py-2 rounded-lg bg-accent-primary text-text-inverse text-sm hover:bg-accent-primary/90"
            >
              Create Task
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {renderBoard()}
    </div>
  )
}
