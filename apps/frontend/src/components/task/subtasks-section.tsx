import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/common/StatusBadge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import type { Task } from '@/types/models'

export function SubtasksSection({ task }: { task: Task }) {
  const context = useProjectStore((state) => state.taskContexts[task.id])
  const isLoadingContext = useProjectStore((state) => state.isLoadingContext)
  const { openSubtaskModal } = useUIStore()
  const subtasks = context?.subtasks || []

  const handleSubtaskClick = (subtaskId: string) => {
    openSubtaskModal(subtaskId)
  }

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.35 }}
        >
          <CheckCircle2 className="h-4 w-4 text-text-muted" />
          <span className="font-medium text-text-primary">
            Subtasks ({subtasks.length})
          </span>
        </motion.div>

        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button variant="ghost" size="sm">
            + Add
          </Button>
        </motion.div>
      </div>

      {isLoadingContext && !context ? (
        <div className="flex items-center justify-center py-6">
          <LoadingSpinner size="sm" />
        </div>
      ) : subtasks.length > 0 ? (
        <div className="space-y-2">
          {subtasks.map((subtask, index) => (
            <motion.div
              key={subtask.id}
              onClick={() => handleSubtaskClick(subtask.id)}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.4 + index * 0.1 }}
              whileHover={{
                scale: 1.02,
                borderColor: 'rgba(0, 217, 255, 0.3)',
                backgroundColor: 'rgba(30, 41, 59, 0.8)',
              }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                'p-3 rounded-lg border cursor-pointer',
                'border-border-default bg-surface-default/30',
                'transition-all duration-200'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-5 h-5 rounded border flex items-center justify-center',
                  subtask.status === 'done'
                    ? 'bg-success border-success text-text-inverse'
                    : 'border-text-muted'
                )}>
                  {subtask.status === 'done' ? <CheckCircle2 className="h-3 w-3" /> : null}
                </div>

                <span className={cn(
                  'flex-1 text-sm',
                  subtask.status === 'done' ? 'line-through text-text-muted' : 'text-text-primary'
                )}>
                  {subtask.title}
                </span>

                <StatusBadge status={subtask.status} showLabel={false} size="sm" />
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-text-muted py-4 text-center">No subtasks yet</div>
      )}
    </motion.div>
  )
}
