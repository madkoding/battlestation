import { useState, useEffect, useRef, useCallback, type UIEvent } from 'react'
import { motion } from 'framer-motion'
import { MessageSquare } from 'lucide-react'
import { LoadingSpinner, EmptyState } from '@/components/common/LoadingSpinner'
import { useAgentStore } from '@/stores/agentStore'
import { commentsApi } from '@/lib/api'
import type { TaskComment } from '@/types/models'
import { CommentItem } from './comment-item'
import { COMMENTS_SCROLL_THRESHOLD_PX } from '@/lib/constants'

const COMMENTS_PAGE_SIZE = 5

export function CommentsSection({ taskId }: { taskId: string }) {
  const developerName = useAgentStore((state) => state.workflow.roles.developer)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [total, setTotal] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [hasMore, setHasMore] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [animateFromIndex, setAnimateFromIndex] = useState(0)
  const commentsLengthRef = useRef(0)

  useEffect(() => {
    commentsLengthRef.current = comments.length
  }, [comments.length])

  const fetchCommentsPage = useCallback(async (offset: number, append: boolean) => {
    if (!taskId) return

    if (append) {
      setIsLoadingMore(true)
      setAnimateFromIndex(commentsLengthRef.current)
    } else {
      setIsInitialLoading(true)
      setAnimateFromIndex(0)
    }
    setLoadError(null)

    try {
      const page = await commentsApi.getByTask(taskId, {
        limit: COMMENTS_PAGE_SIZE,
        offset,
        order: 'desc',
      })

      setTotal(page.total)
      setHasMore(page.has_more)
      setNextOffset(page.next_offset)

      setComments((prev) => {
        const base = append ? prev : []
        const seen = new Set(base.map((item) => item.id))
        const merged = [...base]

        for (const item of page.comments) {
          if (seen.has(item.id)) continue
          merged.push(item)
          seen.add(item.id)
        }

        return merged
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load comments'
      setLoadError(message)
    } finally {
      if (append) {
        setIsLoadingMore(false)
      } else {
        setIsInitialLoading(false)
      }
    }
  }, [taskId])

  useEffect(() => {
    let active = true

    void commentsApi.getByTask(taskId, {
      limit: COMMENTS_PAGE_SIZE,
      offset: 0,
      order: 'desc',
    })
      .then((page) => {
        if (!active) return
        setTotal(page.total)
        setHasMore(page.has_more)
        setNextOffset(page.next_offset)
        setComments(page.comments)
        setLoadError(null)
      })
      .catch((error) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Failed to load comments'
        setLoadError(message)
      })
      .finally(() => {
        if (!active) return
        setIsInitialLoading(false)
      })

    return () => {
      active = false
    }
  }, [taskId])

  const retryFetch = useCallback(() => {
    const canAppend = comments.length > 0 && hasMore && nextOffset != null
    const targetOffset = canAppend ? nextOffset : 0
    void fetchCommentsPage(targetOffset, canAppend)
  }, [comments.length, hasMore, nextOffset, fetchCommentsPage])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!hasMore || isInitialLoading || isLoadingMore || nextOffset == null) return

    const target = event.target as HTMLDivElement
    const remainingPx = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remainingPx <= COMMENTS_SCROLL_THRESHOLD_PX) {
      void fetchCommentsPage(nextOffset, true)
    }
  }, [hasMore, isInitialLoading, isLoadingMore, nextOffset, fetchCommentsPage])

  return (
    <motion.div
      className="flex min-h-[calc(95vh-330px)] sm:min-h-[calc(90vh-360px)] flex-col space-y-3 sm:space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <motion.div
        className="flex items-center gap-2"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
      >
        <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-text-muted" />
        <span className="font-medium text-text-primary text-xs sm:text-sm">Comments ({total})</span>
      </motion.div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1" onScroll={handleScroll}>
        <div className="space-y-2 p-1 sm:p-2">
          {isInitialLoading ? (
            <LoadingSpinner />
          ) : comments.length === 0 ? (
            <EmptyState
              title="No comments yet"
              description="Be the first to comment on this task"
            />
          ) : (
            comments.map((comment, index) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                index={index}
                developerName={developerName}
                animateEntry={index >= animateFromIndex}
              />
            ))
          )}

          {loadError ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {loadError}
              <button
                type="button"
                onClick={retryFetch}
                className="ml-2 underline"
              >
                Retry
              </button>
            </div>
          ) : null}

          {comments.length > 0 ? (
            <div className="pt-1 text-center text-[11px] text-text-muted">
              {hasMore ? (isLoadingMore ? 'Loading older comments...' : 'Scroll down for older comments') : 'You are seeing all comments'}
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  )
}
