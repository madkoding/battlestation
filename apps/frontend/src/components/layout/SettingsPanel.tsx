import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Palette, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppearanceTab } from './AppearanceTab'
import { ProviderSettingsForm } from './ProviderSettingsForm'
import { useSettingsPanel } from '@/hooks/useSettingsPanel'

export function SettingsPanel() {
  const {
    isSettingsOpen,
    setSettingsOpen,
    theme,
    setTheme,
    density,
    setDensity,
    densityMode,
    setDensityMode,
    crtFx,
    setCrtFx,
    activeTab,
    setActiveTab,
    providerSettings,
    setProviderSettings,
    providerCapabilities,
    availableModels,
    isLoadingProvider,
    isSavingProvider,
    isTestingProvider,
    providerHealth,
    showApiKey,
    setShowApiKey,
    currentProviderHealth,
    saveProviderSettings,
    updateProvider,
    updateOllamaProfile,
    updateModel,
    testProvider,
  } = useSettingsPanel()

  return (
    <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-accent-primary" />
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">Application settings for appearance and LLM provider</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-default/40 p-1 mt-2">
          <Button
            variant={activeTab === 'appearance' ? 'default' : 'ghost'}
            size="sm"
            className={cn(activeTab === 'appearance' && 'bg-accent-primary text-text-inverse')}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette className="h-4 w-4 mr-1.5" />
            Appearance
          </Button>
          <Button
            variant={activeTab === 'provider' ? 'default' : 'ghost'}
            size="sm"
            className={cn(activeTab === 'provider' && 'bg-accent-primary text-text-inverse')}
            onClick={() => setActiveTab('provider')}
          >
            <Server className="h-4 w-4 mr-1.5" />
            Provider
          </Button>
        </div>

        <div className="space-y-6 py-4">
          {activeTab === 'appearance' && (
            <AppearanceTab
              theme={theme}
              setTheme={setTheme}
              density={density}
              setDensity={setDensity}
              densityMode={densityMode}
              setDensityMode={setDensityMode}
              crtFx={crtFx}
              setCrtFx={setCrtFx}
            />
          )}

          {activeTab === 'provider' && (
            <ProviderSettingsForm
              providerSettings={providerSettings}
              setProviderSettings={setProviderSettings}
              providerCapabilities={providerCapabilities}
              availableModels={availableModels}
              isLoadingProvider={isLoadingProvider}
              isSavingProvider={isSavingProvider}
              isTestingProvider={isTestingProvider}
              providerHealth={providerHealth}
              showApiKey={showApiKey}
              setShowApiKey={setShowApiKey}
              currentProviderHealth={currentProviderHealth}
              saveProviderSettings={saveProviderSettings}
              updateProvider={updateProvider}
              updateOllamaProfile={updateOllamaProfile}
              updateModel={updateModel}
              testProvider={testProvider}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
