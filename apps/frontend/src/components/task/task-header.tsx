import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { StatusBadge, PriorityBadge, AgentBadge } from '@/components/common/StatusBadge'
import type { Task } from '@/types/models'

export function TaskHeader({ task, project }: { task: Task; project: { name: string } }) {
  return (
    <motion.div
      className="space-y-1.5 sm:space-y-2"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <motion.div
        className="flex items-center gap-1.5 text-[10px] sm:text-xs text-text-muted"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        <span className="truncate max-w-[120px] sm:max-w-[200px]">{project.name}</span>
        <ChevronRight className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" />
        <span className="font-mono">#{task.id.slice(-6)}</span>
      </motion.div>

      <motion.h2
        className="text-base sm:text-lg lg:text-xl font-semibold text-text-primary leading-tight"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 }}
      >
        {task.title}
      </motion.h2>

      <motion.div
        className="flex flex-wrap items-center gap-2 sm:gap-3 pt-1 sm:pt-2"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
      >
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <StatusBadge status={task.status} size="sm" />
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <PriorityBadge priority={task.priority} size="sm" />
        </motion.div>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="hidden xs:block">
          <AgentBadge agent={task.assigned_to || ''} size="sm" />
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
