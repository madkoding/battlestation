import { useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { Layout, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'

export function KanbanModal() {
  const { kanbanModal, isKanbanModalOpen, closeKanbanModal } = useUIStore()
  const { selectedProjectId, setSelectedProject, projects } = useProjectStore()
  const hasMeasuredOpen = useRef(false)

  // Get project name for the title
  const projectName = useMemo(() => {
    const project = projects.find(p => p.id === kanbanModal?.projectId)
    return project?.name || 'Project'
  }, [projects, kanbanModal?.projectId])

  const projectBanner = useMemo(() => {
    const project = projects.find(p => p.id === kanbanModal?.projectId)
    return project?.banner_image_url || ''
  }, [projects, kanbanModal?.projectId])

  // Sync project selection when modal opens
  useEffect(() => {
    if (isKanbanModalOpen && kanbanModal?.projectId) {
      if (selectedProjectId !== kanbanModal.projectId) {
        setSelectedProject(kanbanModal.projectId)
      }
    }
  }, [isKanbanModalOpen, kanbanModal?.projectId, selectedProjectId, setSelectedProject])

  useEffect(() => {
    if (!isKanbanModalOpen || !kanbanModal?.projectId) {
      hasMeasuredOpen.current = false
      return
    }

    if (hasMeasuredOpen.current) {
      return
    }

    const markName = `kanban-open-click:${kanbanModal.projectId}`
    const marks = typeof performance !== 'undefined' ? performance.getEntriesByName(markName, 'mark') : []

    if (!marks.length) {
      return
    }

    hasMeasuredOpen.current = true
    const elapsedMs = performance.now() - marks[marks.length - 1].startTime
    performance.clearMarks(markName)
    console.info(`[perf] Kanban modal opened in ${Math.round(elapsedMs)}ms (${kanbanModal.projectId})`)
  }, [isKanbanModalOpen, kanbanModal?.projectId])

  const handleClose = () => {
    closeKanbanModal()
    setSelectedProject(null)
  }

  if (!isKanbanModalOpen || !kanbanModal) return null

  return (
    <Dialog open={isKanbanModalOpen} onOpenChange={(open) => {
      if (!open) handleClose()
    }}>
      <DialogContent showClose={false} className="max-w-[100vw] w-full max-h-[100dvh] h-[100dvh] overflow-hidden p-0 flex flex-col rounded-none sm:rounded-xl">
        <DialogDescription className="sr-only">Kanban board for project tasks</DialogDescription>
        <DialogHeader className="p-0 flex-shrink-0 border-b border-border-default overflow-hidden">
          <div className="relative h-20 sm:h-24 lg:h-28 px-3 sm:px-4">
            {projectBanner ? (
              <img
                src={projectBanner}
                alt={`${projectName} banner`}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-r from-bg-card via-bg-card/85 to-bg-card/65" />

            <div className="relative z-10 h-full flex items-center gap-2 sm:gap-3">
              <motion.div
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="shrink-0"
              >
                <Layout className="h-5 w-5 sm:h-6 sm:w-6 text-accent-primary" />
              </motion.div>
              <DialogTitle className="text-base sm:text-lg lg:text-xl font-semibold text-text-primary truncate">
                {projectName}
              </DialogTitle>
              <div className="ml-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-text-secondary hover:text-text-primary"
                  onClick={handleClose}
                  aria-label="Close kanban modal"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {selectedProjectId && <KanbanBoard />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
