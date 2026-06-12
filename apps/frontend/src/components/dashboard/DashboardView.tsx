import { Plus, RotateCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedPage } from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { useProjectActions } from '@/hooks/useProjectActions'
import { StatsOverview } from './StatsOverview'
import { ProjectGrid } from './ProjectGrid'
import { CreateProjectDialog } from './CreateProjectDialog'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'

export function DashboardView() {
  const {
    projects,
    isCreateOpen,
    setIsCreateOpen,
    name,
    handleNameChange,
    path,
    setPath,
    isCreating,
    handleCreateProject,
    resetCreateForm,
    projectPendingDelete,
    setProjectPendingDelete,
    deletingProjectId,
    requestDeleteProject,
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
    openProjectSettings,
    handleSaveProjectSettings,
    taskMetrics,
    isLoadingMetrics,
    isRunningCycle,
    handleRunCycle,
  } = useProjectActions()

  return (
    <AnimatedPage className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-xs sm:text-sm text-text-muted">Manage your projects and tasks</p>
        </div>
      </div>

      <StatsOverview
        projectCount={projects.length}
        metrics={taskMetrics}
        isLoading={isLoadingMetrics}
      />

      <div className="grid grid-cols-1 tablet:grid-cols-3 gap-4 sm:gap-6">
        <div className="tablet:col-span-2 space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-semibold text-text-primary">Projects</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 sm:h-9"
                onClick={handleRunCycle}
                disabled={isRunningCycle}
              >
                <RotateCw className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1', isRunningCycle && 'animate-spin')} />
                <span className="text-xs sm:text-sm">Run cycle</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 sm:h-9"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
                <span className="text-xs sm:text-sm">New</span>
              </Button>
            </div>
          </div>

          <ProjectGrid
            onRequestDelete={requestDeleteProject}
            onOpenSettings={openProjectSettings}
            deletingProjectId={deletingProjectId}
          />
        </div>

        <div className="space-y-3 sm:space-y-4">
          <Card className="border-border-default p-4 text-sm text-text-muted">
            Create tasks from each project board.
          </Card>
        </div>
      </div>

      <CreateProjectDialog
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        name={name}
        handleNameChange={handleNameChange}
        path={path}
        setPath={setPath}
        isCreating={isCreating}
        handleCreateProject={handleCreateProject}
        resetCreateForm={resetCreateForm}
      />
      <DeleteProjectDialog
        projectPendingDelete={projectPendingDelete}
        setProjectPendingDelete={setProjectPendingDelete}
        deletingProjectId={deletingProjectId}
        handleDeleteProject={handleDeleteProject}
      />
      <ProjectSettingsDialog
        isOpen={isSettingsOpen}
        setIsOpen={setIsSettingsOpen}
        setSettingsProject={setSettingsProject}
        settingsProject={settingsProject}
        settingsName={settingsName}
        setSettingsName={setSettingsName}
        settingsDescription={settingsDescription}
        setSettingsDescription={setSettingsDescription}
        settingsBanner={settingsBanner}
        setSettingsBanner={setSettingsBanner}
        agentsMd={agentsMd}
        setAgentsMd={setAgentsMd}
        isLoadingSettings={isLoadingSettings}
        isSavingSettings={isSavingSettings}
        handleSaveProjectSettings={handleSaveProjectSettings}
      />
    </AnimatedPage>
  )
}
