import { FolderOpen } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/common/LoadingSpinner'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { ProjectCard } from './ProjectCard'
import type { Project } from '@/types/models'

interface ProjectGridProps {
  onRequestDelete: (project: Project) => void
  onOpenSettings: (project: Project) => void
  deletingProjectId: string | null
}

export function ProjectGrid({
  onRequestDelete,
  onOpenSettings,
  deletingProjectId,
}: ProjectGridProps) {
  const { projects, isLoadingProjects } = useProjectStore()
  const { dashboardQuery } = useUIStore()

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(dashboardQuery.toLowerCase()) ||
    p.path.toLowerCase().includes(dashboardQuery.toLowerCase())
  )

  if (isLoadingProjects) {
    return (
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="h-40 sm:h-44 tablet:h-48 animate-pulse bg-surface-default/50" />
        ))}
      </div>
    )
  }

  if (filteredProjects.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen className="h-12 w-12" />}
        title="No projects found"
        description={dashboardQuery ? "Try adjusting your search terms" : "Create your first project to get started"}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
      {filteredProjects.map((project, index) => (
        <ProjectCard
          key={project.id}
          project={project}
          index={index}
          onRequestDelete={onRequestDelete}
          onOpenSettings={onOpenSettings}
          isDeleting={deletingProjectId === project.id}
        />
      ))}
    </div>
  )
}
