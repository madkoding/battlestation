import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { MarkdownContent } from '@/components/common/MarkdownContent'
import { formatRelativeTime } from '@/lib/utils'
import type { TaskComment } from '@/types/models'
import { parseVicksComment } from '@/utils/diff-parser'
import { VicksCommentContent } from './vicks-comment-content'

export function CommentItem({
  comment,
  index,
  developerName,
  animateEntry,
}: {
  comment: TaskComment
  index: number
  developerName: string
  animateEntry: boolean
}) {
  const isDeveloperComment = (comment.agent_name || '').trim().toLowerCase() === String(developerName || '').trim().toLowerCase()
  const parsedVicks = useMemo(() => {
    return isDeveloperComment ? parseVicksComment(comment.comment || '') : null
  }, [isDeveloperComment, comment.comment])

  return (
    <motion.div
      initial={animateEntry ? { opacity: 0, y: 10, scale: 0.98 } : undefined}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{
        delay: animateEntry ? Math.min(index, 5 - 1) * 0.03 : 0,
        duration: 0.2,
        ease: 'easeOut',
      }}
      className="mx-1 flex gap-3 rounded-xl border border-border-default/60 bg-surface-default/30 p-3 sm:p-3.5"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-default flex items-center justify-center text-text-primary font-medium">
        {comment.agent_name?.[0] || '?'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-text-primary text-xs sm:text-sm">
            {comment.agent_name || 'Unknown'}
          </span>
          <span className="text-xs text-text-muted">
            {formatRelativeTime(comment.created_at)}
          </span>
        </div>

        {parsedVicks ? (
          <VicksCommentContent parsed={parsedVicks} />
        ) : (
          <MarkdownContent content={comment.comment} compact size="xs" />
        )}
      </div>
    </motion.div>
  )
}
