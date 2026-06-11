import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { MoreHorizontal } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PriorityBadge } from '@/components/common/StatusBadge'
import { useUIStore } from '@/stores/uiStore'
import { useAgentStore } from '@/stores/agentStore'
import type { Task } from '@/types/models'
import { cn } from '@/lib/utils'

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

export { TaskCard }
