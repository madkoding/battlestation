import { useSortable } from '@dnd-kit/sortable'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusBadge } from '@/components/common/StatusBadge'
import { type TaskStatus } from '@/lib/constants'
import type { Task } from '@/types/models'
import { TaskCard } from './TaskCard'
import { cn } from '@/lib/utils'

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

export { KanbanColumn }
