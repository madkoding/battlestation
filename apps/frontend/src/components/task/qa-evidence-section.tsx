import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { tasksApi } from '@/lib/api'
import type { QaEvidenceEntry } from '@/lib/api'
import { itemVariants } from './variants'

interface QaPreviewImage {
  src: string
  alt: string
}

export function QaEvidenceSection({ taskId }: { taskId: string }) {
  const [entries, setEntries] = useState<QaEvidenceEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<QaPreviewImage | null>(null)

  const fetchQaEvidence = useCallback(() => {
    setLoadError(null)
    setIsLoading(true)
    let active = true
    void tasksApi.getQaEvidence(taskId)
      .then((result) => {
        if (!active) return
        setEntries(result)
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : 'Failed to load QA evidence'
        setLoadError(message)
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [taskId])

  useEffect(() => {
    return fetchQaEvidence()
  }, [fetchQaEvidence])

  return (
    <motion.section variants={itemVariants} className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs sm:text-sm font-medium text-text-muted">QA Evidence ({entries.length})</h3>
      </div>

      {isLoading ? (
        <LoadingSpinner size="sm" />
      ) : loadError ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          {loadError}
          <button type="button" onClick={fetchQaEvidence} className="ml-2 underline">Retry</button>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-text-muted">No QA evidence captured yet.</div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border-default/60 bg-surface-default/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={cn('font-medium', entry.payload.executed ? 'text-success' : 'text-warning')}>
                  {entry.payload.executed ? 'Executed' : 'Not executed'}
                </span>
                <span className="text-text-muted">{formatRelativeTime(entry.created_at)}</span>
              </div>

              {entry.payload.reason ? (
                <div className="text-xs text-text-secondary">{entry.payload.reason}</div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {entry.payload.screenshots.map((shot, index) => {
                  const src = tasksApi.getQaEvidenceScreenshotUrl(taskId, entry.id, index)
                  const alt = `QA evidence ${shot.viewport}`
                  return (
                    <button
                      key={`${entry.id}-${index}-${shot.path}`}
                      type="button"
                      onClick={() => setPreviewImage({ src, alt })}
                      className="group block rounded-md border border-border-default/60 bg-surface-default/40 p-2 text-left"
                    >
                      <img
                        src={src}
                        alt={alt}
                        className="h-28 w-full rounded object-cover bg-surface-default"
                        loading="lazy"
                      />
                      <div className="mt-1 text-[11px] text-text-muted line-clamp-2 group-hover:text-text-primary transition-colors">
                        {shot.viewport} - {shot.url}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => {
        if (!open) setPreviewImage(null)
      }}>
        <DialogContent className="w-[96vw] max-w-5xl p-2 sm:p-4 bg-bg-card border-border-default">
          <DialogDescription className="sr-only">Screenshot preview</DialogDescription>
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base text-text-primary">
              {previewImage?.alt || 'Screenshot preview'}
            </DialogTitle>
          </DialogHeader>
          {previewImage ? (
            <div className="max-h-[80vh] overflow-auto rounded-md bg-surface-default/40 p-1">
              <img
                src={previewImage.src}
                alt={previewImage.alt}
                className="w-full h-auto rounded object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.section>
  )
}
