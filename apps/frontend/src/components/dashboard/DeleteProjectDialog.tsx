import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Project } from '@/types/models'

interface DeleteProjectDialogProps {
  projectPendingDelete: Project | null
  setProjectPendingDelete: (v: Project | null) => void
  deletingProjectId: string | null
  handleDeleteProject: () => Promise<void>
}

export function DeleteProjectDialog({
  projectPendingDelete,
  setProjectPendingDelete,
  deletingProjectId,
  handleDeleteProject,
}: DeleteProjectDialogProps) {
  return (
    <Dialog
      open={Boolean(projectPendingDelete)}
      onOpenChange={(open) => {
        if (!open && !deletingProjectId) {
          setProjectPendingDelete(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Delete Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Delete <span className="font-semibold text-text-primary">{projectPendingDelete?.name}</span> from Battlestation?
          </p>
          <p className="text-xs text-text-muted">
            This only removes the project from Battlestation and does not delete project folders or files.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setProjectPendingDelete(null)}
              disabled={Boolean(deletingProjectId)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteProject}
              disabled={Boolean(deletingProjectId)}
            >
              {deletingProjectId ? 'Deleting...' : 'Delete project'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
