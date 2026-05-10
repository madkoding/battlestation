import { useEffect, useState, useRef, type UIEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge, PriorityBadge } from '@/components/common/StatusBadge'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import { useAgentStore } from '@/stores/agentStore'
import { STATUSES, STATUS_META, type TaskStatus } from '@/lib/constants'
import type { Task } from '@/types/models'
import { cn } from '@/lib/utils'

// Task Card Component (Sortable)
interface TaskCardProps {
  task: Task
  isOverlay?: boolean
}

function getStageAgeMeta(task: Task): { label: string; alert: boolean } | null {
  const sourceTs = task.stage_notified_at || task.updated_at || task.created_at
  const ts = Date.parse(sourceTs || '')
  if (!Number.isFinite(ts)) {
    return null
  }

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60000))
  if (elapsedMinutes < 60) {
    return { label: `${elapsedMinutes}m`, alert: elapsedMinutes >= 30 }
  }
  const hours = Math.floor(elapsedMinutes / 60)
  if (hours < 24) {
    return { label: `${hours}h`, alert: hours >= 8 }
  }
  const days = Math.floor(hours / 24)
  return { label: `${days}d`, alert: days >= 1 }
}

function TaskCard({ task, isOverlay = false }: TaskCardProps) {
  const { openTaskModal } = useUIStore()
  const getAgentRole = useAgentStore((state) => state.getAgentRole)
  const stageAge = getStageAgeMeta(task)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const handleClick = () => {
    if (isDragging) return
    openTaskModal(task.id)
  }

  const assignee = task.assigned_to || 'Unassigned'
  const role = getAgentRole(assignee).toLowerCase()
  const roleIcon = role.includes('orchestrator') ? '◈' : role.includes('qa') ? '🔍' : role.includes('developer') || role.includes('engineer') ? '⚡' : '●'

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
      whileHover={{ scale: isOverlay ? 1 : 1.02 }}
      onClick={handleClick}
      className={cn(
        "group cursor-pointer",
        isOverlay && "rotate-2 scale-105 z-50"
      )}
    >
      <Card
        className={cn(
          "p-2 sm:p-3 border-border-default bg-bg-card",
          "hover:border-accent-primary/30 hover:shadow-sm",
          "transition-all duration-200",
          isOverlay && "shadow-xl border-accent-primary shadow-glow"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-1.5 sm:mb-2">
          <h4 className="text-xs sm:text-sm font-medium text-text-primary line-clamp-2 flex-1 leading-tight">
            {task.title}
          </h4>

          <div className="flex items-center gap-1.5">
            {stageAge ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                  stageAge.alert
                    ? 'border-warning/50 bg-warning/15 text-warning animate-pulse'
                    : 'border-border-default bg-surface-default/50 text-text-muted'
                )}
                title="Tiempo en columna"
              >
                {stageAge.label}
              </span>
            ) : null}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-text-muted" />
            </div>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <PriorityBadge priority={task.priority} showLabel={false} size="sm" />

          <div className="flex items-center gap-1 text-[10px] sm:text-xs text-text-muted">
            <span>{roleIcon}</span>
            <span className="hidden xs:inline">{assignee}</span>
          </div>

          <span className="text-[10px] sm:text-xs text-text-muted ml-auto font-mono">
            #{task.id.slice(-4)}
          </span>
        </div>

        {/* Subtasks indicator */}
        {task.subtask_count && task.subtask_count > 0 ? (
          <div className="mt-1.5 sm:mt-2 pt-1.5 sm:pt-2 border-t border-border-default flex items-center gap-2">
            <div className="flex-1 h-1 bg-surface-default rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all"
                style={{
                  width: `${(task.completed_subtasks || 0) / task.subtask_count * 100}%`
                }}
              />
            </div>
            <span className="text-[10px] sm:text-xs text-text-muted">
              {task.completed_subtasks || 0}/{task.subtask_count}
            </span>
          </div>
        ) : null}
      </Card>
    </motion.div>
  )
}

// Kanban Column Component
interface KanbanColumnProps {
  status: TaskStatus
  tasks: Task[]
  layout?: 'carousel' | 'grid' | 'desktop'
  onCreateTodoTask: () => void
}

function KanbanColumn({ status, tasks, layout = 'desktop', onCreateTodoTask }: KanbanColumnProps) {
  const { setNodeRef } = useSortable({
    id: status,
    data: {
      type: 'column',
      status,
    },
  })

  const isTodoColumn = status === 'todo'

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col h-full min-h-[100dvh]',
        layout === 'carousel' && 'min-w-full',
        layout === 'grid' && 'min-w-0 min-h-[20rem]',
        layout === 'desktop' && 'min-w-[260px] flex-1'
      )}
    >
      {/* Column header - compact layout */}
      <div className={cn(
        "flex items-center justify-between p-1.5 sm:p-2 tablet:p-3 rounded-t-lg",
        "bg-surface-default/50 border-b border-border-default"
      )}>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <StatusBadge status={status} showLabel size="sm" />
          <span className="text-[10px] sm:text-xs text-text-muted">
            {tasks.length}
          </span>
        </div>

        {isTodoColumn ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={onCreateTodoTask}
          >
            <Plus className="h-3.5 w-3.5" />
            New task
          </Button>
        ) : null}
      </div>

      {/* Task list - reduced padding */}
      <ScrollArea className="flex-1 bg-surface-default/20 rounded-b-lg">
        <div className="p-1.5 sm:p-2 space-y-1.5 sm:space-y-2 min-h-[100px]">
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence>
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </AnimatePresence>
          </SortableContext>

          {tasks.length === 0 && (
            <div className="text-center py-6 sm:py-8 text-text-muted text-xs sm:text-sm">
              Drop tasks here
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

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
        } catch (error) {
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
      {/* Mobile navigation - compact and intuitive */}
      <div className="md:hidden flex flex-col border-b border-border-default">
        <div className="flex items-center justify-between px-2 py-1.5 sm:px-3 sm:py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToColumn('left')}
            disabled={currentColumnIndex === 0}
            className="h-8 w-8 sm:h-9 sm:w-9 text-text-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
          </Button>
          <div className="flex flex-col items-center">
            <span className="text-xs sm:text-sm font-medium text-text-primary">
              {STATUS_META[STATUSES[currentColumnIndex]].label}
            </span>
            <span className="text-[10px] text-text-muted">
              {tasksByStatus[STATUSES[currentColumnIndex]].length} tasks · {currentColumnIndex + 1}/{STATUSES.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToColumn('right')}
            disabled={currentColumnIndex === STATUSES.length - 1}
            className="h-8 w-8 sm:h-9 sm:w-9 text-text-muted disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
          </Button>
        </div>
        <div className="px-3 pb-1.5 text-[10px] text-text-muted text-center">
          Swipe or scroll horizontally to change column
        </div>
        
        {/* Progress indicator bar */}
        <div className="flex h-0.5 bg-surface-default">
          {STATUSES.map((_, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 transition-colors duration-200",
                index === currentColumnIndex ? "bg-accent-primary" : "bg-transparent"
              )}
            />
          ))}
        </div>
      </div>

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

      {/* Mobile pagination dots - larger and easier to tap */}
      <div className="md:hidden flex justify-center gap-2 py-2 sm:py-3 border-t border-border-default">
        {STATUSES.map((status, index) => (
          <button
            key={index}
            onClick={() => goToColumn(index)}
            className={cn(
              "h-2 sm:h-2.5 rounded-full transition-all duration-200",
              index === currentColumnIndex
                ? "w-6 sm:w-8 bg-accent-primary"
                : "w-2 sm:w-2.5 bg-text-muted/30 hover:bg-text-muted/50"
            )}
            aria-label={`Go to ${STATUS_META[status].label} column`}
          />
        ))}
      </div>

      <Dialog
        open={isCreateModalOpen}
        onOpenChange={(open) => {
          setIsCreateModalOpen(open)
          if (!open) {
            resetCreateTaskForm()
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">New Todo Task</DialogTitle>
          </DialogHeader>

          <form className="space-y-3" onSubmit={handleCreateTaskSubmit}>
            <Input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              placeholder="Task title"
              autoFocus
              required
            />

            <Textarea
              value={newTaskDescription}
              onChange={(event) => setNewTaskDescription(event.target.value)}
              placeholder="Optional description"
              rows={3}
            />

            <Select
              value={newTaskPriority}
              onValueChange={(value) => setNewTaskPriority(value as 'low' | 'medium' | 'high')}
            >
              <SelectTrigger>
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low priority</SelectItem>
                <SelectItem value="medium">Medium priority</SelectItem>
                <SelectItem value="high">High priority</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsCreateModalOpen(false)
                  resetCreateTaskForm()
                }}
                disabled={isCreatingTask}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingTask || !newTaskTitle.trim()}>
                {isCreatingTask ? 'Creating...' : 'Create task'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
