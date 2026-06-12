import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, ChevronLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { containerVariants, itemVariants } from './variants'
import { TaskHeader } from './task-header'
import { TaskDescription } from './task-description'
import { TaskMetadata } from './task-metadata'
import { CommentsSection } from './comments-section'
import { QaEvidenceSection } from './qa-evidence-section'
import { SubtasksSection } from './subtasks-section'

export function TaskModal() {
  const isOpen = useUIStore((state) => state.modalStack.length > 0)
  const taskId = useUIStore((state) => {
    const currentModal = state.modalStack[state.modalStack.length - 1]
    return currentModal?.taskId
  })
  const modalType = useUIStore((state) => {
    const currentModal = state.modalStack[state.modalStack.length - 1]
    return currentModal?.type
  })
  const canGoBack = useUIStore((state) => state.canGoBack)
  const closeModal = useUIStore((state) => state.closeModal)
  const closeAllModals = useUIStore((state) => state.closeAllModals)
  const context = useProjectStore((state) => (taskId ? state.taskContexts[taskId] : undefined))
  const isLoadingContext = useProjectStore((state) => state.isLoadingContext)
  const commentsRefreshToken = useProjectStore((state) => (taskId ? (state.taskCommentsVersion[taskId] || 0) : 0))
  const loadTaskContext = useProjectStore((state) => state.loadTaskContext)
  const [loadError, setLoadError] = useState(false)
  const prevLoading = useRef(false)

  useEffect(() => {
    if (!isOpen || !taskId) return
    if (context) return
    setLoadError(false)
    void loadTaskContext(taskId)
  }, [isOpen, taskId, loadTaskContext, context])

  useEffect(() => {
    if (prevLoading.current && !isLoadingContext && !context) {
      setLoadError(true)
    }
    prevLoading.current = isLoadingContext
  }, [isLoadingContext, context])

  const handleClose = () => {
    if (canGoBack()) {
      closeModal()
    } else {
      closeAllModals()
    }
  }

  const handleBack = () => {
    closeModal()
  }

  if (!isOpen || !taskId) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) handleClose()
    }}>
      <DialogContent className="w-full max-w-full sm:max-w-lg tablet:max-w-2xl lg:max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden p-0 rounded-lg sm:rounded-xl">
        <DialogDescription className="sr-only">Task details and comments</DialogDescription>
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:pb-0 border-b border-border-default sm:border-0">
          <AnimatePresence mode="wait">
            {canGoBack() && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="h-8 text-text-muted hover:text-text-primary group px-2"
                >
                  <motion.div
                    className="flex items-center"
                    whileHover={{ x: -3 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1 transition-transform group-hover:-translate-x-1" />
                    <span className="text-xs sm:text-sm">Back</span>
                  </motion.div>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8 sm:hidden ml-auto"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <AnimatePresence mode="wait">
          {loadError ? (
            <motion.div
              key="error"
              className="flex flex-col items-center justify-center gap-3 h-[300px] sm:h-[400px] px-4"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
            >
              <AlertCircle className="h-8 w-8 text-danger" />
              <p className="text-sm text-text-muted text-center">Failed to load task details</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!taskId) return
                  setLoadError(false)
                  void loadTaskContext(taskId)
                }}
              >
                Retry
              </Button>
            </motion.div>
          ) : !context ? (
            <motion.div
              key="loading"
              className="flex items-center justify-center h-[300px] sm:h-[400px]"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
            >
              <LoadingSpinner size="lg" />
            </motion.div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <DialogHeader className="px-4 pb-0 pt-2 sm:px-6 sm:pt-4">
                <DialogTitle className="sr-only">Task details</DialogTitle>
                <TaskHeader task={context.task} project={context.project} />
              </DialogHeader>

              <ScrollArea className="flex-1 h-[calc(95vh-120px)] sm:h-[calc(90vh-140px)]">
                <motion.div
                  className="p-4 sm:p-6 space-y-4 sm:space-y-6"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <div className="space-y-4 sm:space-y-6">
                    <motion.div variants={itemVariants}>
                      <TaskMetadata task={context.task} />
                    </motion.div>

                    <motion.section variants={itemVariants}>
                      <h3 className="text-xs sm:text-sm font-medium text-text-muted mb-2">Description</h3>
                      <TaskDescription description={context.task.description} />
                    </motion.section>

                    {modalType === 'task' && (
                      <section>
                        <SubtasksSection task={context.task} />
                      </section>
                    )}

                    <motion.section variants={itemVariants}>
                      <CommentsSection key={`${context.task.id}:${commentsRefreshToken}`} taskId={context.task.id} />
                    </motion.section>

                    <QaEvidenceSection taskId={context.task.id} />
                  </div>
                </motion.div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
