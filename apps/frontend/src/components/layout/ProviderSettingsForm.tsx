import { type ProviderSettings, type ProviderCapability } from '@/lib/api'
import { type ProviderHealth } from '@/hooks/useSettingsPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Server, Cloud, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProviderSettingsFormProps {
  providerSettings: ProviderSettings
  setProviderSettings: React.Dispatch<React.SetStateAction<ProviderSettings>>
  providerCapabilities: ProviderCapability[]
  availableModels: string[]
  isLoadingProvider: boolean
  isSavingProvider: boolean
  isTestingProvider: boolean
  providerHealth: Partial<Record<ProviderSettings['provider'], ProviderHealth>>
  showApiKey: boolean
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>
  currentProviderHealth: ProviderHealth
  saveProviderSettings: (next: ProviderSettings) => Promise<void>
  updateProvider: (provider: ProviderSettings['provider']) => Promise<void>
  updateOllamaProfile: (profile: ProviderSettings['profile']) => Promise<void>
  updateModel: () => Promise<void>
  testProvider: (provider?: ProviderSettings['provider'], notify?: boolean) => Promise<void>
}

export function ProviderSettingsForm(props: ProviderSettingsFormProps) {
  const {
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
  } = props

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
          <Server className="h-4 w-4" />
          LLM Provider
          <Badge
            variant="outline"
            className={cn(
              'ml-auto text-[10px] uppercase tracking-wide',
              currentProviderHealth.status === 'ok' && 'border-emerald-500/40 text-emerald-600',
              currentProviderHealth.status === 'error' && 'border-red-500/40 text-red-500',
              currentProviderHealth.status === 'testing' && 'border-border-default text-text-muted',
              currentProviderHealth.status === 'idle' && 'border-border-default text-text-muted',
            )}
          >
            {currentProviderHealth.status === 'ok' && 'Connected'}
            {currentProviderHealth.status === 'error' && 'Invalid'}
            {currentProviderHealth.status === 'testing' && 'Testing'}
            {currentProviderHealth.status === 'idle' && 'Not tested'}
          </Badge>
        </label>
        <Select
          value={providerSettings.provider}
          onValueChange={(value) => updateProvider(value as ProviderSettings['provider'])}
          disabled={isLoadingProvider || isSavingProvider}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {providerCapabilities.map((provider) => {
              const status = providerHealth[provider.id]?.status || 'idle'

              return (
                <SelectItem
                  key={provider.id}
                  value={provider.id}
                  disabled={!provider.ready}
                >
                  <div className="flex items-center gap-2">
                    <span>{provider.label}</span>
                    {!provider.ready && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Soon</Badge>
                    )}
                    {provider.ready && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] uppercase tracking-wide',
                          status === 'ok' && 'border-emerald-500/40 text-emerald-600',
                          status === 'error' && 'border-red-500/40 text-red-500',
                          status === 'testing' && 'border-border-default text-text-muted',
                          status === 'idle' && 'border-border-default text-text-muted',
                        )}
                      >
                        {status === 'ok' && 'Connected'}
                        {status === 'error' && 'Invalid'}
                        {status === 'testing' && 'Testing'}
                        {status === 'idle' && 'Not tested'}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void testProvider(providerSettings.provider, true)}
            disabled={isLoadingProvider || isSavingProvider || isTestingProvider}
          >
            {isTestingProvider ? 'Testing...' : 'Test connection'}
          </Button>
          {currentProviderHealth.status !== 'idle' && (
            <p className={cn(
              'text-xs mt-2',
              currentProviderHealth.status === 'ok' && 'text-emerald-600',
              currentProviderHealth.status === 'error' && 'text-red-500',
              currentProviderHealth.status === 'testing' && 'text-text-muted',
            )}>
              {currentProviderHealth.message}
              {currentProviderHealth.checkedAt && currentProviderHealth.status !== 'testing' && (
                <span className="text-text-muted"> · {new Date(currentProviderHealth.checkedAt).toLocaleString()}</span>
              )}
            </p>
          )}
          {currentProviderHealth.stages && currentProviderHealth.status !== 'testing' && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge
                variant="outline"
                className={cn(
                  currentProviderHealth.stages.models_ok
                    ? 'border-emerald-500/40 text-emerald-600'
                    : 'border-red-500/40 text-red-500',
                )}
              >
                Models {currentProviderHealth.stages.models_ok ? 'OK' : 'FAIL'}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  currentProviderHealth.stages.chat_ok
                    ? 'border-emerald-500/40 text-emerald-600'
                    : 'border-red-500/40 text-red-500',
                )}
              >
                Chat {currentProviderHealth.stages.chat_ok ? 'OK' : 'FAIL'}
              </Badge>
            </div>
          )}
          <p className="text-xs text-text-muted">
            Ollama, OpenAI, and GitHub Copilot are available. Anthropic/Google are still scaffolded.
          </p>
      </div>

          {providerSettings.provider === 'ollama' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={providerSettings.profile === 'local' ? 'default' : 'outline'}
              size="sm"
              disabled={isLoadingProvider || isSavingProvider}
              className={cn(providerSettings.profile === 'local' && 'bg-accent-primary text-text-inverse')}
              onClick={() => updateOllamaProfile('local')}
            >
              <Server className="h-4 w-4 mr-1.5" />
              Localhost
            </Button>
            <Button
              variant={providerSettings.profile === 'cloud' ? 'default' : 'outline'}
              size="sm"
              disabled={isLoadingProvider || isSavingProvider}
              className={cn(providerSettings.profile === 'cloud' && 'bg-accent-primary text-text-inverse')}
              onClick={() => updateOllamaProfile('cloud')}
            >
              <Cloud className="h-4 w-4 mr-1.5" />
              Ollama Cloud
            </Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary">Model</label>
            <Select
              value={providerSettings.model}
              onValueChange={(value) => {
                const next = { ...providerSettings, model: value }
                setProviderSettings(next)
                void saveProviderSettings(next)
              }}
              disabled={isLoadingProvider || isSavingProvider || availableModels.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model} value={model}>{model}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableModels.length === 0 && isSavingProvider && (
              <p className="text-xs text-text-muted">Loading models...</p>
            )}
            {availableModels.length === 0 && !isSavingProvider && (
              <p className="text-xs text-text-muted">Could not load models. Check your API key.</p>
            )}
          </div>

          {providerSettings.profile === 'local' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-secondary">Base URL</label>
              <Input
                value={providerSettings.base_url}
                onChange={(e) => setProviderSettings((current) => ({ ...current, base_url: e.target.value }))}
                onBlur={updateModel}
                disabled={isLoadingProvider || isSavingProvider}
                placeholder="http://localhost:11434"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary">API key</label>
            <div className="relative">
                <Input
                type={showApiKey ? 'text' : 'password'}
                value={providerSettings.api_key || ''}
                onChange={(e) => setProviderSettings((current) => ({ ...current, api_key: e.target.value }))}
                onBlur={updateModel}
                disabled={isLoadingProvider || isSavingProvider || providerSettings.profile === 'local'}
                placeholder={providerSettings.profile === 'cloud' ? 'Paste API key (stored encrypted in DB)' : 'Not needed for local'}
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                onClick={() => setShowApiKey((current) => !current)}
                disabled={isLoadingProvider || isSavingProvider || providerSettings.profile === 'local'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-text-muted">Stored in DB; UI shows masked value after save.</p>
          </div>

          {providerSettings.profile === 'local' && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-default/50">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Verify TLS certificates</p>
                <p className="text-xs text-text-muted">Disable only for trusted local/self-signed setups.</p>
              </div>
              <Switch
                checked={providerSettings.verify_tls}
                onCheckedChange={(checked) => {
                  const next = { ...providerSettings, verify_tls: checked }
                  setProviderSettings(next)
                  void saveProviderSettings(next)
                }}
                disabled={isLoadingProvider || isSavingProvider || providerSettings.profile === 'local'}
              />
            </div>
          )}
        </>
      ) : providerSettings.provider === 'openai' || providerSettings.provider === 'github_copilot' ? (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary">Model</label>
            <Select
              value={providerSettings.model}
              onValueChange={(value) => {
                const next = { ...providerSettings, model: value }
                setProviderSettings(next)
                void saveProviderSettings(next)
              }}
              disabled={isLoadingProvider || isSavingProvider || availableModels.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model} value={model}>{model}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableModels.length === 0 && (
              <p className="text-xs text-text-muted">Could not load models for this provider.</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary">Base URL</label>
            <Input
              value={providerSettings.base_url}
              onChange={(e) => setProviderSettings((current) => ({ ...current, base_url: e.target.value }))}
              onBlur={updateModel}
              disabled={isLoadingProvider || isSavingProvider}
              placeholder={providerSettings.provider === 'github_copilot' ? 'https://api.githubcopilot.com' : 'https://api.openai.com/v1'}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary">API key</label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={providerSettings.api_key || ''}
                onChange={(e) => setProviderSettings((current) => ({ ...current, api_key: e.target.value }))}
                onBlur={updateModel}
                disabled={isLoadingProvider || isSavingProvider}
                placeholder="Paste API key (stored encrypted in DB)"
                className="pr-10"
              />
              <button
                type="button"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                onClick={() => setShowApiKey((current) => !current)}
                disabled={isLoadingProvider || isSavingProvider}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-text-muted">Stored in DB; UI shows masked value after save.</p>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border-default bg-surface-default/40 p-3">
          <p className="text-sm text-text-secondary">
            Provider wiring for {providerSettings.provider} is planned. Keep this selected to prepare settings,
            then switch back to Ollama for live chat execution today.
          </p>
        </div>
      )}
    </div>
  )
}
