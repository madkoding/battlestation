import { motion } from 'framer-motion'
import { MarkdownContent } from '@/components/common/MarkdownContent'

export function TaskDescription({ description }: { description?: string }) {
  if (!description) {
    return (
      <motion.div
        className="text-text-muted text-sm italic"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        No description provided
      </motion.div>
    )
  }

  return (
    <motion.div
      className="max-w-none"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
    >
      <MarkdownContent content={description} />
    </motion.div>
  )
}
