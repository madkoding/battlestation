import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { isValidUrl, cn } from '@/lib/utils'
import type { Project } from '@/types/models'

interface ProjectSettingsDialogProps {
  isOpen: boolean
  setIsOpen: (v: boolean) => void
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

export function ProjectSettingsDialog({
  isOpen,
  setIsOpen,
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
}: ProjectSettingsDialogProps) {
  const bannerError = settingsBanner && !isValidUrl(settingsBanner) ? 'Invalid URL format' : ''

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) setSettingsProject(null)
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">
            Project Settings{settingsProject ? ` · ${settingsProject.name}` : ''}
          </DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSaveProjectSettings}>
          <div className="space-y-2">
            <label htmlFor="settings-title" className="text-sm font-medium text-text-primary">Title</label>
            <Input
              id="settings-title"
              value={settingsName}
              onChange={(e) => setSettingsName(e.target.value)}
              placeholder="Project title"
              required
              disabled={isLoadingSettings || isSavingSettings}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-description" className="text-sm font-medium text-text-primary">Description</label>
            <Textarea
              id="settings-description"
              value={settingsDescription}
              onChange={(e) => setSettingsDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={4}
              disabled={isLoadingSettings || isSavingSettings}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-banner" className="text-sm font-medium text-text-primary">Banner Image URL</label>
            <Input
              id="settings-banner"
              value={settingsBanner}
              onChange={(e) => setSettingsBanner(e.target.value)}
              placeholder="https://..."
              disabled={isLoadingSettings || isSavingSettings}
              className={cn(bannerError && 'border-danger')}
            />
            {bannerError && <p className="text-xs text-danger">{bannerError}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-agents-md" className="text-sm font-medium text-text-primary">AGENTS.md</label>
            <Textarea
              id="settings-agents-md"
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
              onClick={() => setIsOpen(false)}
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
  )
}
