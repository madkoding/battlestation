import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/uiStore'
import { COPY_FEEDBACK_MS } from '@/lib/constants'
import { cn } from '@/lib/utils'

export function ConnectionStatusPopover({ onOpenActivity }: { onOpenActivity: () => void }) {
  const { wsConnectionState, wsLastError, wsLastConnectedAt } = useUIStore()
  const [isOpen, setIsOpen] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const wsTooltip = [
    `State: ${wsConnectionState}`,
    wsLastConnectedAt ? `Last connected: ${new Date(wsLastConnectedAt).toLocaleString()}` : 'Last connected: never',
    wsLastError ? `Last error: ${wsLastError}` : null,
  ].filter(Boolean).join('\n')

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(wsTooltip)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), COPY_FEEDBACK_MS)
    } catch {
      setIsCopied(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown, { passive: true })
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={panelRef} className="relative flex items-center gap-1">
      <motion.button
        type="button"
        onClick={onOpenActivity}
        className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full bg-surface-default/50 hover:bg-surface-hover/60 transition-colors"
        animate={{
          boxShadow: [
            '0 0 0px rgba(0, 217, 255, 0)',
            '0 0 10px rgba(0, 217, 255, 0.3)',
            '0 0 0px rgba(0, 217, 255, 0)',
          ],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            wsConnectionState === 'connected' && 'bg-accent-primary animate-pulse',
            wsConnectionState === 'connecting' && 'bg-yellow-400 animate-pulse',
            wsConnectionState === 'reconnecting' && 'bg-orange-400 animate-pulse',
            wsConnectionState === 'offline' && 'bg-red-500',
          )}
        />
        <span className="text-xs text-text-secondary">
          {wsConnectionState === 'connected' && 'LIVE'}
          {wsConnectionState === 'connecting' && 'CONNECTING'}
          {wsConnectionState === 'reconnecting' && 'RECONNECTING'}
          {wsConnectionState === 'offline' && 'OFFLINE'}
        </span>
      </motion.button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Show websocket status details"
      >
        <Info className="h-3.5 w-3.5 text-text-muted" />
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed left-2 right-2 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-72 rounded-md border border-border-default bg-bg-card p-3 shadow-xl z-50"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-primary">Realtime Connection</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => void copyDiagnostics()}
                aria-label="Copy websocket diagnostics"
              >
                {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-text-muted" />}
              </Button>
            </div>
            <p className="text-xs text-text-secondary whitespace-pre-line">{wsTooltip}</p>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  setIsOpen(false)
                  onOpenActivity()
                }}
              >
                Open Live Feed
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
