import { motion } from 'framer-motion'
import { FolderOpen, ChevronRight, Trash2, Settings, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/uiStore'
import { useToastStore } from '@/stores/toastStore'
import { cn } from '@/lib/utils'
import type { Project } from '@/types/models'

interface ProjectCardProps {
  project: Project
  index: number
  onRequestDelete: (project: Project) => void
  onOpenSettings: (project: Project) => void
  isDeleting: boolean
}

export function ProjectCard({
  project,
  index,
  onRequestDelete,
  onOpenSettings,
  isDeleting,
}: ProjectCardProps) {
  const { openKanbanModal } = useUIStore()
  const { addToast } = useToastStore()

  const handleClick = () => {
    if (typeof performance !== 'undefined') {
      performance.mark(`kanban-open-click:${project.id}`)
    }
    openKanbanModal(project.id)
    addToast('info', `Opened Kanban board for ${project.name}`)
  }

  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRequestDelete(project)
  }

  const handleSettingsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenSettings(project)
  }

  const gradientColors = [
    'from-accent-primary/20 to-accent-secondary/20',
    'from-accent-secondary/20 to-accent-tertiary/20',
    'from-accent-tertiary/20 to-accent-primary/20',
    'from-status-progress/20 to-accent-primary/20',
  ]
  const gradient = gradientColors[index % gradientColors.length]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Card
        onClick={handleClick}
        className={cn(
          "group cursor-pointer overflow-hidden",
          "border-border-default bg-bg-card hover:border-accent-primary/50",
          "transition-all duration-300 hover:shadow-glow"
        )}
      >
        <div className={cn(
          "h-16 sm:h-20 tablet:h-24 bg-gradient-to-br relative overflow-hidden",
          gradient
        )}>
          {project.banner_image_url ? (
            <img
              src={project.banner_image_url}
              alt={`${project.name} banner`}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xKSIvPjwvc3ZnPg==')] opacity-30" />

          <motion.div
            className="absolute top-3 right-3 sm:top-4 sm:right-4 w-9 h-9 sm:w-10 sm:h-10 tablet:w-12 tablet:h-12 rounded-xl bg-bg-card/80 backdrop-blur-sm flex items-center justify-center border border-border-default"
            whileHover={{ rotate: 10 }}
          >
            <FolderOpen className="h-4 w-4 sm:h-5 sm:w-5 tablet:h-6 tablet:w-6 text-accent-primary" />
          </motion.div>
        </div>

        <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-text-primary group-hover:text-accent-primary transition-colors line-clamp-1">
                {project.name}
              </h3>
              <p className="text-xs text-text-muted line-clamp-1 mt-1">
                {project.path}
              </p>
            </div>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-muted hover:text-accent-primary"
                onClick={handleSettingsClick}
                aria-label={`Open settings for ${project.name}`}
              >
                <Settings className="h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-muted hover:text-accent-danger"
                onClick={handleDeleteClick}
                disabled={isDeleting}
                aria-label={`Delete project ${project.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <CheckCircle2 className="h-3.5 w-3.5 text-status-done" />
              <span>{project.task_count || 0} tasks</span>
            </div>

            <motion.div
              className="flex items-center gap-1 text-xs text-accent-primary ml-auto"
              whileHover={{ x: 4 }}
            >
              <span>Open</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </motion.div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
