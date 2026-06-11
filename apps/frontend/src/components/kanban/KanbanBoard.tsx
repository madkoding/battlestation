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
import { useProjectStore } from '@/stores/projectStore'
import { useToastStore } from '@/stores/toastStore'
import { STATUSES, STATUS_META, type TaskStatus } from '@/lib/constants'
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
  const currentProjectTasks = selectedProjectId ? projectTasks[selectedProjectId] : undefined
  const isInitialLoading = isLoadingTasks && !currentProjectTasks

  useEffect(() => {
    if (!selectedProjectId || currentProjectTasks) {
      return
    }

    void loadProjectTasks(selectedProjectId)
  }, [selectedProjectId, currentProjectTasks, loadProjectTasks])

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
        distance: 8,
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

  return (
    <div className="h-full flex flex-col">
      {isInitialLoading ? (
        <div className="px-3 py-2 text-xs text-text-muted border-b border-border-default bg-surface-default/30">
          Loading tasks...
        </div>
      ) : null}

      <MobileNav
        currentColumnIndex={currentColumnIndex}
        goToColumn={goToColumn}
        scrollToColumn={scrollToColumn}
        tasksByStatus={tasksByStatus}
      />

      {/* Board - Responsive Layout */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Mobile: Single-column swipe view optimized for 9.7" tablets */}
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

        {/* Tablet: 2x2 grid for easier visibility */}
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

        {/* Desktop: 4 columns */}
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
    </div>
  )
}
