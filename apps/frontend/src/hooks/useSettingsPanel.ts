import { useCallback, useEffect, useMemo, useState } from 'react'
import { settingsApi, type ProviderSettings, type ProviderCapability } from '@/lib/api'
import { useToastStore } from '@/stores/toastStore'
import { useUIStore } from '@/stores/uiStore'

export type ProviderTab = 'appearance' | 'provider'
export type ProviderHealthStatus = 'idle' | 'testing' | 'ok' | 'error'

export interface ProviderHealth {
  status: ProviderHealthStatus
  message: string
  checkedAt?: string
  stages?: {
    models_ok: boolean
    chat_ok: boolean
  }
}

export const PROVIDERS: ProviderCapability[] = [
  { id: 'ollama', label: 'Ollama', ready: true, mode: 'native', supports_local: true },
  { id: 'openai', label: 'OpenAI', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'github_copilot', label: 'GitHub Copilot', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'anthropic', label: 'Anthropic', ready: false, mode: 'planned', supports_local: false },
  { id: 'google', label: 'Google', ready: false, mode: 'planned', supports_local: false },
]

export const defaultProviderSettings: ProviderSettings = {
  provider: 'ollama',
  profile: 'cloud',
  model: 'minimax-m2.7',
  base_url: 'https://ollama.com/v1',
  api_key: '',
  verify_tls: true,
}

export const providerDefaults: Record<ProviderSettings['provider'], { model: string; base_url: string; verify_tls: boolean; profile: ProviderSettings['profile'] }> = {
  ollama: { model: 'minimax-m2.7', base_url: 'https://ollama.com/v1', verify_tls: true, profile: 'cloud' },
  openai: { model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1', verify_tls: true, profile: 'cloud' },
  github_copilot: { model: 'gpt-4o-mini', base_url: 'https://api.githubcopilot.com', verify_tls: true, profile: 'cloud' },
  anthropic: { model: 'claude-3-5-sonnet-latest', base_url: 'https://api.anthropic.com', verify_tls: true, profile: 'cloud' },
  google: { model: 'gemini-1.5-flash', base_url: 'https://generativelanguage.googleapis.com', verify_tls: true, profile: 'cloud' },
}

export function getDefaultProviderSettings(provider: ProviderSettings['provider']): ProviderSettings {
  const defaults = providerDefaults[provider]
  return { provider, profile: defaults.profile, model: defaults.model, base_url: defaults.base_url, api_key: '', verify_tls: defaults.verify_tls }
}

export function useSettingsPanel() {
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

  return {
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
  }
}
