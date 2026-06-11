import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Project } from '@/types/models'

interface ProjectDialogsProps {
  isCreateOpen: boolean
  setIsCreateOpen: (v: boolean) => void
  name: string
  handleNameChange: (v: string) => void
  path: string
  setPath: (v: string) => void
  setIsPathEdited: (v: boolean) => void
  isCreating: boolean
  handleCreateProject: (e: React.FormEvent<HTMLFormElement>) => Promise<void>
  resetCreateForm: () => void
  projectPendingDelete: Project | null
  setProjectPendingDelete: (v: Project | null) => void
  deletingProjectId: string | null
  handleDeleteProject: () => Promise<void>
  isSettingsOpen: boolean
  setIsSettingsOpen: (v: boolean) => void
  setSettingsProject: (v: Project | null) => void
  settingsProject: Project | null
  settingsName: string
  setSettingsName: (v: string) => void
  settingsDescription: string
  setSettingsDescription: (v: string) => void
  settingsBanner: string
  setSettingsBanner: (v: string) => void
  agentsMd: string
  setAgentsMd: (v: string) => void
  isLoadingSettings: boolean
  isSavingSettings: boolean
  handleSaveProjectSettings: (e: React.FormEvent<HTMLFormElement>) => Promise<void>
}

export function ProjectDialogs(props: ProjectDialogsProps) {
  const {
    isCreateOpen,
    setIsCreateOpen,
    name,
    handleNameChange,
    path,
    setPath,
    setIsPathEdited,
    isCreating,
    handleCreateProject,
    resetCreateForm,
    projectPendingDelete,
    setProjectPendingDelete,
    deletingProjectId,
    handleDeleteProject,
    isSettingsOpen,
    setIsSettingsOpen,
    setSettingsProject,
    settingsProject,
    settingsName,
    setSettingsName,
    settingsDescription,
    setSettingsDescription,
    settingsBanner,
    setSettingsBanner,
    agentsMd,
    setAgentsMd,
    isLoadingSettings,
    isSavingSettings,
    handleSaveProjectSettings,
  } = props

  return (
    <>
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) {
            resetCreateForm()
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Create Project</DialogTitle>
          </DialogHeader>

          <form className="space-y-3" onSubmit={handleCreateProject}>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Project name"
              autoFocus
              required
            />
            <Input
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setIsPathEdited(true)
              }}
              placeholder="/path/to/project"
              required
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsCreateOpen(false)
                  resetCreateForm()
                }}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || !name.trim() || !path.trim()}>
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(projectPendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingProjectId) {
            setProjectPendingDelete(null)
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
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

      <Dialog
        open={isSettingsOpen}
        onOpenChange={(open) => {
          setIsSettingsOpen(open)
          if (!open) {
            setSettingsProject(null)
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Project Settings{settingsProject ? ` · ${settingsProject.name}` : ''}
            </DialogTitle>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSaveProjectSettings}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Title</label>
              <Input
                value={settingsName}
                onChange={(e) => setSettingsName(e.target.value)}
                placeholder="Project title"
                required
                disabled={isLoadingSettings || isSavingSettings}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Description</label>
              <Textarea
                value={settingsDescription}
                onChange={(e) => setSettingsDescription(e.target.value)}
                placeholder="What is this project about?"
                rows={4}
                disabled={isLoadingSettings || isSavingSettings}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Banner Image URL</label>
              <Input
                value={settingsBanner}
                onChange={(e) => setSettingsBanner(e.target.value)}
                placeholder="https://..."
                disabled={isLoadingSettings || isSavingSettings}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">AGENTS.md</label>
              <Textarea
                value={agentsMd}
                onChange={(e) => setAgentsMd(e.target.value)}
                placeholder="Project context and instructions for AI agents"
                rows={16}
                disabled={isLoadingSettings || isSavingSettings}
              />
              <p className="text-xs text-text-muted">
                AGENTS.md defines project context for your configured agent profiles. If missing, the orchestrator profile creates it automatically.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsSettingsOpen(false)}
                disabled={isSavingSettings}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoadingSettings || isSavingSettings || !settingsName.trim()}>
                {isSavingSettings ? 'Saving...' : 'Save settings'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
