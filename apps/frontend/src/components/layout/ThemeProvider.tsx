import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme, useAutoDensity } from '@/hooks/useTheme'
import { useUIStore } from '@/stores/uiStore'
import { THEMES, THEME_META } from '@/lib/constants'
import { settingsApi, type ProviderSettings, type ProviderCapability } from '@/lib/api'
import { useToastStore } from '@/stores/toastStore'
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { 
  Palette, 
  Monitor, 
  ScanLine,
  Check,
  Server,
  Cloud,
  Eye,
  EyeOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const PROVIDERS: ProviderCapability[] = [
  { id: 'ollama', label: 'Ollama', ready: true, mode: 'native', supports_local: true },
  { id: 'openai', label: 'OpenAI', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'github_copilot', label: 'GitHub Copilot', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'anthropic', label: 'Anthropic', ready: false, mode: 'planned', supports_local: false },
  { id: 'google', label: 'Google', ready: false, mode: 'planned', supports_local: false },
]

type ProviderTab = 'appearance' | 'provider'
type ProviderHealthStatus = 'idle' | 'testing' | 'ok' | 'error'

interface ProviderHealth {
  status: ProviderHealthStatus
  message: string
  checkedAt?: string
  stages?: {
    models_ok: boolean
    chat_ok: boolean
  }
}

const defaultProviderSettings: ProviderSettings = {
  provider: 'ollama',
  profile: 'cloud',
  model: 'minimax-m2.7',
  base_url: 'https://ollama.com/v1',
  api_key: '',
  verify_tls: true,
}

const providerDefaults: Record<ProviderSettings['provider'], { model: string; base_url: string; verify_tls: boolean; profile: ProviderSettings['profile'] }> = {
  ollama: {
    model: 'minimax-m2.7',
    base_url: 'https://ollama.com/v1',
    verify_tls: true,
    profile: 'cloud',
  },
  openai: {
    model: 'gpt-4o-mini',
    base_url: 'https://api.openai.com/v1',
    verify_tls: true,
    profile: 'cloud',
  },
  github_copilot: {
    model: 'gpt-4o-mini',
    base_url: 'https://api.githubcopilot.com',
    verify_tls: true,
    profile: 'cloud',
  },
  anthropic: {
    model: 'claude-3-5-sonnet-latest',
    base_url: 'https://api.anthropic.com',
    verify_tls: true,
    profile: 'cloud',
  },
  google: {
    model: 'gemini-1.5-flash',
    base_url: 'https://generativelanguage.googleapis.com',
    verify_tls: true,
    profile: 'cloud',
  },
}

function getDefaultProviderSettings(provider: ProviderSettings['provider']): ProviderSettings {
  const defaults = providerDefaults[provider]
  return {
    provider,
    profile: defaults.profile,
    model: defaults.model,
    base_url: defaults.base_url,
    api_key: '',
    verify_tls: defaults.verify_tls,
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  
  useAutoDensity()
  
  return <>{children}</>
}

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
    setCrtFx
  } = useUIStore()
  const { addToast } = useToastStore()
  const [activeTab, setActiveTab] = useState<ProviderTab>('appearance')
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(defaultProviderSettings)
  const [providerConfigMap, setProviderConfigMap] = useState<Partial<Record<ProviderSettings['provider'], ProviderSettings>>>({})
  const [providerCapabilities, setProviderCapabilities] = useState<ProviderCapability[]>(PROVIDERS)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isLoadingProvider, setIsLoadingProvider] = useState(false)
  const [isSavingProvider, setIsSavingProvider] = useState(false)
  const [isTestingProvider, setIsTestingProvider] = useState(false)
  const [providerHealth, setProviderHealth] = useState<Partial<Record<ProviderSettings['provider'], ProviderHealth>>>({})
  const [showApiKey, setShowApiKey] = useState(false)

  const loadProviderModels = useCallback(async (provider: ProviderSettings['provider']) => {
    try {
      const response = await settingsApi.getProviderModels(provider)
      setAvailableModels(response.models)
    } catch {
      setAvailableModels([])
    }
  }, [])

  useEffect(() => {
    if (!isSettingsOpen) return

    let isMounted = true
    const loadProvider = async () => {
      setIsLoadingProvider(true)
      try {
        const [response, capabilities, allSettings] = await Promise.all([
          settingsApi.getProvider(),
          settingsApi.getProviderCapabilities(),
          settingsApi.getAll(),
        ])
        if (isMounted) {
          setProviderSettings(response)
          setProviderCapabilities(capabilities.providers)
          const configsRaw = allSettings.model_provider_configs
          const nextMap: Partial<Record<ProviderSettings['provider'], ProviderSettings>> = {}
          if (configsRaw && typeof configsRaw === 'object') {
            Object.entries(configsRaw as Record<string, unknown>).forEach(([key, value]) => {
              if (!(key in providerDefaults) || !value || typeof value !== 'object') return
              const provider = key as ProviderSettings['provider']
              const defaults = getDefaultProviderSettings(provider)
              const current = value as Partial<ProviderSettings>
              nextMap[provider] = {
                provider,
                profile: provider === 'ollama' && current.profile === 'local' ? 'local' : 'cloud',
                model: String(current.model || defaults.model),
                base_url: String(current.base_url || defaults.base_url),
                api_key: String(current.api_key || ''),
                verify_tls: typeof current.verify_tls === 'boolean' ? current.verify_tls : defaults.verify_tls,
              }
            })
          }
          nextMap[response.provider] = {
            ...response,
            api_key: String(response.api_key || ''),
          }
          setProviderConfigMap(nextMap)
          await loadProviderModels(response.provider)
          const health = await settingsApi.getProviderHealth()
          if (health?.providers) {
            const nextHealth: Partial<Record<ProviderSettings['provider'], ProviderHealth>> = {}
            Object.entries(health.providers).forEach(([providerRaw, value]) => {
              if (!value) return
              const provider = providerRaw as ProviderSettings['provider']
              nextHealth[provider] = {
                status: value.ok ? 'ok' : 'error',
                message: value.message,
                checkedAt: value.checked_at,
                stages: value.stages,
              }
            })
            setProviderHealth((current) => ({
              ...current,
              ...nextHealth,
            }))
          }
        }
      } catch {
        addToast('error', 'Could not load provider settings')
      } finally {
        if (isMounted) {
          setIsLoadingProvider(false)
        }
      }
    }

    loadProvider()
    return () => {
      isMounted = false
    }
  }, [isSettingsOpen, addToast, loadProviderModels])

  const saveProviderSettings = async (next: ProviderSettings) => {
    setIsSavingProvider(true)
    try {
      const nextMap = {
        ...providerConfigMap,
        [next.provider]: next,
      }
      await settingsApi.update('model_provider_configs', nextMap)
      await settingsApi.update('model_provider', next.provider)
      setProviderConfigMap(nextMap)
      setProviderSettings(next)
      await loadProviderModels(next.provider)
      await testProvider(next.provider, false)
      addToast('success', 'Provider settings saved')
    } catch {
      addToast('error', 'Could not save provider settings')
    } finally {
      setIsSavingProvider(false)
    }
  }

  const updateProvider = async (provider: ProviderSettings['provider']) => {
    const next = providerConfigMap[provider] || getDefaultProviderSettings(provider)
    setAvailableModels([])
    setProviderHealth((current) => ({
      ...current,
      [provider]: current[provider] || { status: 'idle', message: 'Not tested yet' },
    }))
    await saveProviderSettings(next)
  }

  const updateOllamaProfile = async (profile: ProviderSettings['profile']) => {
    const next: ProviderSettings = {
      ...providerSettings,
      profile,
      base_url: profile === 'local' ? 'http://localhost:11434' : 'https://ollama.com/v1',
      verify_tls: profile === 'cloud',
    }
    await saveProviderSettings(next)
  }

  const updateModel = async () => {
    await saveProviderSettings(providerSettings)
  }

  const activeProviderHealth = useMemo<ProviderHealth>(() => {
    return providerHealth[providerSettings.provider] || { status: 'idle', message: 'Not tested yet' }
  }, [providerHealth, providerSettings.provider])

  useEffect(() => {
    if (!isSettingsOpen) return
    if (providerHealth[providerSettings.provider]) return
    const nextProvider = providerSettings.provider
    const timer = window.setTimeout(() => {
      setProviderHealth((current) => ({
        ...current,
        [nextProvider]: current[nextProvider] || { status: 'idle', message: 'Not tested yet' },
      }))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [providerHealth, providerSettings.provider, isSettingsOpen])

  const testProvider = async (provider = providerSettings.provider, notify = true) => {
    setIsTestingProvider(true)
    setProviderHealth((current) => ({
      ...current,
      [provider]: { status: 'testing', message: 'Testing connection...' },
    }))

    try {
      const result = await settingsApi.testProvider(provider)
      setProviderHealth((current) => ({
        ...current,
        [provider]: {
          status: result.ok ? 'ok' : 'error',
          message: result.message,
          checkedAt: result.checked_at,
          stages: result.stages,
        },
      }))

      if (result.ok) {
        if (notify) addToast('success', result.message)
      } else {
        if (notify) addToast('error', result.message)
      }
    } catch {
      setProviderHealth((current) => ({
        ...current,
        [provider]: {
          status: 'error',
          message: 'Could not test provider connection',
        },
      }))
      if (notify) addToast('error', 'Could not test provider connection')
    } finally {
      setIsTestingProvider(false)
    }
  }

  const currentProviderHealth = activeProviderHealth
  
  return (
    <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-accent-primary" />
            Settings
          </DialogTitle>
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
            <>
          {/* Theme Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Theme
            </label>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <Button
                  key={t}
                  variant={theme === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme(t)}
                  className={cn(
                    "justify-start gap-2",
                    theme === t && "bg-accent-primary text-text-inverse"
                  )}
                >
                  {theme === t && <Check className="h-3 w-3" />}
                  <span>{THEME_META[t].label}</span>
                </Button>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              {THEME_META[theme].description}
            </p>
          </div>
          
          {/* Density */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Density
            </label>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-default/50">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{density === 'compact' ? 'Compact' : 'Normal'}</p>
                <p className="text-xs text-text-muted">
                  {densityMode === 'auto' ? 'Auto-detected from screen size' : 'Manually set'}
                </p>
              </div>
              <Switch
                checked={density === 'compact'}
                onCheckedChange={(checked) => {
                  setDensityMode('manual')
                  setDensity(checked ? 'compact' : 'normal')
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={densityMode === 'auto'}
                onCheckedChange={(checked) => 
                  setDensityMode(checked ? 'auto' : 'manual')
                }
              />
              <span className="text-xs text-text-secondary">Auto-detect</span>
            </div>
          </div>
          
          {/* CRT Effect */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              Effects
            </label>
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-default/50">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">CRT Scanlines</p>
                <p className="text-xs text-text-muted">Retro monitor effect overlay</p>
              </div>
              <Switch
                checked={crtFx === 'on'}
                onCheckedChange={(checked) => setCrtFx(checked ? 'on' : 'off')}
              />
            </div>
          </div>
            </>
          )}

          {activeTab === 'provider' && (
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
