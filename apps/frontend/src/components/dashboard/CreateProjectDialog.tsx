import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CreateProjectDialogProps {
  isOpen: boolean
  setIsOpen: (v: boolean) => void
  name: string
  handleNameChange: (v: string) => void
  path: string
  setPath: (v: string) => void
  isCreating: boolean
  handleCreateProject: (e: React.FormEvent<HTMLFormElement>) => Promise<void>
  resetCreateForm: () => void
}

export function CreateProjectDialog({
  isOpen,
  setIsOpen,
  name,
  handleNameChange,
  path,
  setPath,
  isCreating,
  handleCreateProject,
  resetCreateForm,
}: CreateProjectDialogProps) {
  const nameError = name.trim() && name.length > 120 ? 'Project name is too long (max 120 characters)' : ''

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) resetCreateForm()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Create Project</DialogTitle>
        </DialogHeader>

        <form className="space-y-3" onSubmit={handleCreateProject}>
          <div className="space-y-1">
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Project name"
              autoFocus
              required
              className={cn(nameError && 'border-danger')}
            />
            {nameError && <p className="text-xs text-danger">{nameError}</p>}
          </div>

          <div className="space-y-1">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/project"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsOpen(false)
                resetCreateForm()
              }}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !name.trim() || !path.trim() || !!nameError}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
