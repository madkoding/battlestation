import { motion } from 'framer-motion'
import { GitBranch } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import type { Task } from '@/types/models'
import { containerVariants, itemVariants } from './variants'
import { TaskStatusActions } from './task-status-actions'

export function TaskMetadata({ task }: { task: Task }) {
  return (
    <motion.div
      className="space-y-2 sm:space-y-3"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="space-y-1.5 sm:space-y-2">
        {task.workspace_path ? (
          <motion.div
            className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 text-xs sm:text-sm"
            variants={itemVariants}
          >
            <div className="text-text-muted shrink-0">Workspace:</div>
            <div className="text-text-secondary font-mono text-[10px] sm:text-xs break-all">
              {task.workspace_path}
            </div>
          </motion.div>
        ) : null}

        {(Number(task.escalation_count || 0) > 0 || Number(task.requeue_count || 0) > 0) ? (
          <motion.div
            className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs text-text-muted"
            variants={itemVariants}
          >
            <span className="rounded border border-border-default/60 bg-surface-default/40 px-2 py-0.5">
              Escalations: {Number(task.escalation_count || 0)}
            </span>
            <span className="rounded border border-border-default/60 bg-surface-default/40 px-2 py-0.5">
              Requeues: {Number(task.requeue_count || 0)}
            </span>
            {task.last_escalated_at ? (
              <span>Last escalation: {formatRelativeTime(task.last_escalated_at)}</span>
            ) : null}
            {task.last_requeued_at ? (
              <span>Last requeue: {formatRelativeTime(task.last_requeued_at)}</span>
            ) : null}
          </motion.div>
        ) : null}

        {task.work_branch ? (
          <motion.div
            className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
            variants={itemVariants}
          >
            <GitBranch className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-text-muted shrink-0" />
            <span className="text-text-secondary font-mono text-xs sm:text-sm truncate">{task.work_branch}</span>
          </motion.div>
        ) : null}
      </div>

      <motion.hr
        className="border-border-default"
        variants={itemVariants}
      />

      <motion.div variants={itemVariants}>
        <TaskStatusActions task={task} />
      </motion.div>
    </motion.div>
  )
}
