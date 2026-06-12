import type { FastifyInstance } from 'fastify'
import { getConfig, updateConfig } from '../services/config'
import { getDb, saveDb } from '../db/sqlite-client'
import { getRuntimePolicy } from '../services/policy'

type ProviderId = 'ollama' | 'openai' | 'github_copilot' | 'anthropic' | 'google'
type AgentId = 'kosmos' | 'vicks' | 'wedge'

export interface ProviderSettings {
  provider: ProviderId
  profile: 'local' | 'cloud'
  model: string
  base_url: string
  api_key: string
  verify_tls: boolean
}

interface ProviderCapability {
  id: ProviderId
  label: string
  ready: boolean
  mode: string
  supports_local: boolean
}

interface ProviderHealthState {
  ok: boolean
  message: string
  checked_at: string
  stages?: {
    models_ok: boolean
    chat_ok: boolean
  }
}

interface ProviderTestResult {
  ok: boolean
  message: string
  stages?: {
    models_ok: boolean
    chat_ok: boolean
  }
}

interface AgentTuningView {
  temperature: number
  top_p: number
  max_tokens: number
}

function toAgentTuningView(value: unknown): AgentTuningView {
  const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
  return {
    temperature: Number(raw.temperature ?? 0.2),
    top_p: Number(raw.top_p ?? 0.9),
    max_tokens: Number(raw.max_tokens ?? 16384),
  }
}

const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  { id: 'ollama', label: 'Ollama', ready: true, mode: 'native+openai', supports_local: true },
  { id: 'openai', label: 'OpenAI', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'github_copilot', label: 'GitHub Copilot', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'anthropic', label: 'Anthropic', ready: true, mode: 'openai-compatible', supports_local: false },
  { id: 'google', label: 'Google', ready: false, mode: 'planned', supports_local: false },
]

const providerHealthCache: Partial<Record<ProviderId, ProviderHealthState>> = {}

async function loadProviderHealthFromDb(): Promise<Partial<Record<ProviderId, ProviderHealthState>>> {
  const db = await getDb()
  const result = db.exec("SELECT value FROM config_store WHERE key = 'provider_health'")
  if (!result.length || !result[0].values.length) {
    return {}
  }

  try {
    const raw = String(result[0].values[0][0] || '{}')
    const parsed = JSON.parse(raw) as Partial<Record<ProviderId, ProviderHealthState>>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function saveProviderHealthToDb(health: Partial<Record<ProviderId, ProviderHealthState>>): Promise<void> {
  const db = await getDb()
  const payload = JSON.stringify(health)
  db.run('INSERT OR REPLACE INTO config_store (key, value) VALUES (?, ?)', ['provider_health', payload])
  saveDb(db)
}

async function ensureProviderHealthCacheLoaded(): Promise<void> {
  if (Object.keys(providerHealthCache).length > 0) return
  const fromDb = await loadProviderHealthFromDb()
  Object.assign(providerHealthCache, fromDb)
}

const PROVIDER_DEFAULTS: Record<ProviderId, Omit<ProviderSettings, 'provider'>> = {
  ollama: { profile: 'cloud', model: '', base_url: 'https://ollama.com/v1', api_key: '', verify_tls: true },
  openai: { profile: 'cloud', model: '', base_url: 'https://api.openai.com/v1', api_key: '', verify_tls: true },
  github_copilot: { profile: 'cloud', model: '', base_url: 'https://api.githubcopilot.com', api_key: '', verify_tls: true },
  anthropic: { profile: 'cloud', model: '', base_url: 'https://api.anthropic.com', api_key: '', verify_tls: true },
  google: { profile: 'cloud', model: '', base_url: 'https://generativelanguage.googleapis.com', api_key: '', verify_tls: true },
}

const SECRET_MASK = '********'

function sanitizeHeaderToken(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (/[^\x20-\x7E]/.test(trimmed)) return ''
  return trimmed
}

function getProviderSettingsFromConfig(provider: ProviderId, config: Awaited<ReturnType<typeof getConfig>>): ProviderSettings {
  const defaults = PROVIDER_DEFAULTS[provider]
  const current = config.llm?.providers?.[provider] || {}
  const storedApiKey = sanitizeHeaderToken(String(current.api_key || ''))

  return {
    provider,
    profile: provider === 'ollama'
      ? (current.profile === 'local' ? 'local' : 'cloud')
      : 'cloud',
    model: String(current.model || defaults.model),
    base_url: String(current.base_url || defaults.base_url),
    api_key: storedApiKey ? SECRET_MASK : '',
    verify_tls: typeof current.verify_tls === 'boolean' ? current.verify_tls : defaults.verify_tls,
  }
}

function resolveProviderApiKeyFromConfig(provider: ProviderId, config: Awaited<ReturnType<typeof getConfig>>): string {
  const providerConfig = config.llm?.providers?.[provider] || {}
  const profile = provider === 'ollama'
    ? (providerConfig.profile === 'local' ? 'local' : 'cloud')
    : 'cloud'

  if (provider === 'ollama' && profile === 'local') {
    return ''
  }

  return sanitizeHeaderToken(String(providerConfig.api_key || ''))
}

async function fetchProviderModels(settings: ProviderSettings, apiKey: string): Promise<string[]> {
  if (settings.provider === 'ollama') {
    if (settings.profile === 'local') {
      const response = await fetch('http://localhost:11434/api/tags')
      if (!response.ok) return []
      const data = await response.json() as { models?: Array<{ name: string }> }
      return (data.models || []).map((m) => m.name)
    }

    const cleanBaseUrl = settings.base_url.replace(/\/$/, '')
    const response = await fetch(`${cleanBaseUrl}/models`, {
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    })
    if (!response.ok) return []
    const data = await response.json() as { data?: Array<{ id: string }> }
    return (data.data || []).map((m) => m.id)
  }

    if (settings.provider === 'openai' || settings.provider === 'github_copilot') {
      const cleanBaseUrl = settings.base_url.replace(/\/$/, '')
      const response = await fetch(`${cleanBaseUrl}/models`, {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      })
      if (!response.ok) return []
      const data = await response.json() as { data?: Array<{ id: string }> }
      return (data.data || []).map((m) => m.id)
    }

    if (settings.provider === 'anthropic') {
      return []
    }

  return []
}

async function testProviderConnection(settings: ProviderSettings, apiKey: string): Promise<ProviderTestResult> {
  const probeChatCompletions = async (baseUrl: string, model: string, providerLabel: string) => {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '')
    const response = await fetch(`${cleanBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Health check: reply with ok' }],
        temperature: 0,
        max_tokens: 8,
      }),
    })

    if (!response.ok) {
      let details = response.statusText
      try {
        const payload = await response.json() as { error?: { message?: string } | string; message?: string }
        const nested = payload?.error
        details = typeof nested === 'string'
          ? nested
          : String(nested?.message || payload?.message || details)
      } catch {
        // ignore json parse errors and keep status text
      }
      return {
        ok: false,
        message: `${providerLabel} chat probe failed (${response.status}): ${details}`,
        stages: { models_ok: true, chat_ok: false },
      }
    }

    return {
      ok: true,
      message: `${providerLabel} chat probe ok`,
      stages: { models_ok: true, chat_ok: true },
    }
  }

  try {
    if (settings.provider === 'ollama') {
      if (settings.profile === 'local') {
        const response = await fetch('http://localhost:11434/api/version')
        if (!response.ok) {
          return { ok: false, message: `Ollama local responded ${response.status}` }
        }
        return {
          ok: true,
          message: 'Connected to Ollama local',
          stages: { models_ok: true, chat_ok: true },
        }
      }

      const cleanBaseUrl = settings.base_url.replace(/\/$/, '')
      const response = await fetch(`${cleanBaseUrl}/models`, {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      })
      if (!response.ok) {
        return {
          ok: false,
          message: `Ollama cloud models probe failed (${response.status})`,
          stages: { models_ok: false, chat_ok: false },
        }
      }
      const chatProbe = await probeChatCompletions(cleanBaseUrl, settings.model, 'Ollama cloud')
      if (!chatProbe.ok) {
        return chatProbe
      }
      return {
        ok: true,
        message: 'Connected to Ollama cloud (models + chat)',
        stages: { models_ok: true, chat_ok: true },
      }
    }

    if (settings.provider === 'openai' || settings.provider === 'github_copilot') {
      const cleanBaseUrl = settings.base_url.replace(/\/$/, '')
      const response = await fetch(`${cleanBaseUrl}/models`, {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      })
      if (!response.ok) {
        return {
          ok: false,
          message: `${settings.provider} models probe failed (${response.status})`,
          stages: { models_ok: false, chat_ok: false },
        }
      }
      const chatProbe = await probeChatCompletions(cleanBaseUrl, settings.model, settings.provider)
      if (!chatProbe.ok) {
        return chatProbe
      }
      return {
        ok: true,
        message: `Connected to ${settings.provider} (models + chat)`,
        stages: { models_ok: true, chat_ok: true },
      }
    }

    if (settings.provider === 'anthropic') {
      return {
        ok: false,
        message: 'Anthropic provider test is not implemented yet',
        stages: { models_ok: false, chat_ok: false },
      }
    }

    return {
      ok: false,
      message: 'Provider not supported yet',
      stages: { models_ok: false, chat_ok: false },
    }
  } catch (err: unknown) {
    return {
      ok: false,
      message: `Connection failed: ${String(err)}`,
      stages: { models_ok: false, chat_ok: false },
    }
  }
}

function mergeProviderConfigs(
  current: Awaited<ReturnType<typeof getConfig>>,
  input: Record<string, Partial<ProviderSettings>>,
) {
  const nextProviders = { ...(current.llm?.providers || {}) }

  for (const [providerRaw, settings] of Object.entries(input)) {
    const provider = providerRaw as ProviderId
    if (!PROVIDER_DEFAULTS[provider]) continue

    const previous = nextProviders[provider] || {}
    const defaults = PROVIDER_DEFAULTS[provider]
    const profile = provider === 'ollama'
      ? (settings.profile === 'local' ? 'local' : (settings.profile === 'cloud' ? 'cloud' : (previous.profile === 'local' ? 'local' : defaults.profile)))
      : 'cloud'

    const hasApiKeyField = Object.prototype.hasOwnProperty.call(settings, 'api_key')
    const requestedApiKeyRaw = hasApiKeyField ? String(settings.api_key || '') : ''
    const requestedApiKey = sanitizeHeaderToken(requestedApiKeyRaw)
    const previousApiKey = sanitizeHeaderToken(String(previous.api_key || ''))
    const nextApiKey = hasApiKeyField
      ? (requestedApiKeyRaw.trim() === SECRET_MASK ? previousApiKey : requestedApiKey)
      : previousApiKey

    nextProviders[provider] = {
      ...previous,
      model: settings.model || previous.model || defaults.model,
      base_url: settings.base_url || previous.base_url || defaults.base_url,
      verify_tls: typeof settings.verify_tls === 'boolean'
        ? settings.verify_tls
        : (typeof previous.verify_tls === 'boolean' ? previous.verify_tls : defaults.verify_tls),
      profile,
      api_key: nextApiKey,
    }
  }

  return nextProviders
}

export async function registerSettingsRoutes(fastify: FastifyInstance) {
  await ensureProviderHealthCacheLoaded()

  fastify.get('/api/settings', async () => {
    const config = await getConfig()
    const provider = config.llm?.default_provider || ''

    const modelProviderConfigs = Object.fromEntries(
      (Object.keys(PROVIDER_DEFAULTS) as ProviderId[]).map((id) => [id, getProviderSettingsFromConfig(id, config)]),
    )

    return {
      theme: 'dark',
      density: 'normal',
      crtFx: 'off',
      model_provider: provider,
      model_provider_configs: modelProviderConfigs,
    }
  })

  fastify.get('/api/settings/provider', async () => {
    const config = await getConfig()
    const provider = config.llm?.default_provider || ''
    if (!provider) {
      return { provider: '', profile: 'cloud', model: '', base_url: '', api_key: '', verify_tls: true }
    }
    return getProviderSettingsFromConfig(provider as ProviderId, config)
  })

  fastify.get('/api/settings/provider/capabilities', async () => {
    return {
      providers: PROVIDER_CAPABILITIES,
      chat_compatible: PROVIDER_CAPABILITIES.filter((p) => p.ready).map((p) => p.id),
    }
  })

  fastify.get('/api/settings/provider/health', async () => {
    await ensureProviderHealthCacheLoaded()
    return {
      providers: providerHealthCache,
    }
  })

  fastify.get('/api/settings/provider/models', async (request) => {
    const query = request.query as { provider?: ProviderId }
    const config = await getConfig()
    const provider = query.provider || config.llm?.default_provider || ''
    if (!provider) {
      return { provider: '', models: [], selected: '' }
    }
    const settings = getProviderSettingsFromConfig(provider as ProviderId, config)
    const apiKey = resolveProviderApiKeyFromConfig(provider as ProviderId, config)

    try {
      const models = await fetchProviderModels(settings, apiKey)
      return {
        provider,
        models,
        selected: settings.model,
      }
    } catch (err: unknown) {
      return {
        provider,
        models: [],
        selected: settings.model,
        error: String(err),
      }
    }
  })

  fastify.patch('/api/settings/:key', async (request) => {
    const { key } = request.params as { key: string }
    const { value } = request.body as { value: unknown }
    const current = await getConfig()

    if (key === 'model_provider') {
      const provider = String(value || '').trim()
      if (provider && !PROVIDER_DEFAULTS[provider as ProviderId]) {
        return { key, value: current.llm?.default_provider || '' }
      }

      const next = await updateConfig({
        llm: {
          ...current.llm,
          default_provider: provider,
        },
      })

      return { key, value: next.llm.default_provider }
    }

    if (key === 'model_provider_configs' && value && typeof value === 'object') {
      const input = value as Record<string, Partial<ProviderSettings>>
      const providers = mergeProviderConfigs(current, input)

      const next = await updateConfig({
        llm: {
          ...current.llm,
          providers,
        },
      })

      const sanitized = Object.fromEntries(
        (Object.keys(PROVIDER_DEFAULTS) as ProviderId[]).map((id) => [id, getProviderSettingsFromConfig(id, next)]),
      )

      return { key, value: sanitized }
    }

    return { key, value }
  })

  fastify.get('/api/settings/llm/source-of-truth', async () => {
    const config = await getConfig()
    const provider = config.llm?.default_provider || ''
    if (!provider) {
      return { provider: '', model: '', base_url: '', source: 'none' }
    }
    const settings = getProviderSettingsFromConfig(provider as ProviderId, config)
    return {
      provider,
      model: settings.model,
      base_url: settings.base_url,
      source: 'llm.default_provider + llm.providers[provider]',
      agent_fields_mirror_only: true,
    }
  })

  fastify.patch('/api/settings/agents/:agentId/tuning', async (request) => {
    const { agentId } = request.params as { agentId: AgentId }
    const { temperature, top_p, max_tokens } = request.body as {
      temperature?: number
      top_p?: number
      max_tokens?: number
    }

    const allowedAgents: AgentId[] = ['kosmos', 'vicks', 'wedge']
    if (!allowedAgents.includes(agentId)) {
      return { ok: false, message: `Unknown agent '${String(agentId)}'` }
    }

    const current = await getConfig()
    const existing = current.agents?.[agentId]
    if (!existing) {
      return { ok: false, message: `Agent '${agentId}' config not found` }
    }

    const nextTemperature = Number.isFinite(Number(temperature))
      ? Math.max(0, Math.min(2, Number(temperature)))
      : Number(existing.temperature || 0.2)
    const nextTopP = Number.isFinite(Number(top_p))
      ? Math.max(0.01, Math.min(1, Number(top_p)))
      : Number(existing.top_p || 0.9)
    const nextMaxTokens = Number.isFinite(Number(max_tokens))
      ? Math.max(512, Math.min(131072, Math.round(Number(max_tokens))))
      : Number(existing.max_tokens || 16384)

    const next = await updateConfig({
      agents: {
        ...current.agents,
        [agentId]: {
          ...existing,
          temperature: nextTemperature,
          top_p: nextTopP,
          max_tokens: nextMaxTokens,
        },
      },
    })

    return {
      ok: true,
      agent: agentId,
      tuning: {
        temperature: next.agents[agentId].temperature,
        top_p: next.agents[agentId].top_p,
        max_tokens: next.agents[agentId].max_tokens,
      },
    }
  })

  fastify.post('/api/settings/agents/tuning/preset', async (request) => {
    const { preset } = request.body as { preset?: 'strict' | 'balanced' | 'exploratory' }
    const selected: 'strict' | 'balanced' | 'exploratory' =
      preset === 'strict' || preset === 'balanced' || preset === 'exploratory'
        ? preset
        : 'balanced'

    const presets = getRuntimePolicy('global').settings.tuning_presets

    const current = await getConfig()
    const nextAgents = { ...current.agents }
    for (const id of ['kosmos', 'vicks', 'wedge'] as AgentId[]) {
      nextAgents[id] = {
        ...nextAgents[id],
        ...presets[selected][id],
      }
    }

    const next = await updateConfig({ agents: nextAgents })
    return {
      ok: true,
      preset: selected,
      agents: {
        kosmos: toAgentTuningView(next.agents.kosmos),
        vicks: toAgentTuningView(next.agents.vicks),
        wedge: toAgentTuningView(next.agents.wedge),
      },
    }
  })

  fastify.get('/api/settings/agents/tuning', async () => {
    const config = await getConfig()
    return {
      kosmos: toAgentTuningView(config.agents?.kosmos),
      vicks: toAgentTuningView(config.agents?.vicks),
      wedge: toAgentTuningView(config.agents?.wedge),
    }
  })

  fastify.post('/api/settings/provider/test', async (request) => {
    const body = request.body as { provider?: ProviderId }
    const config = await getConfig()
    const provider = (body.provider || config.llm?.default_provider || 'ollama') as ProviderId
    const settings = getProviderSettingsFromConfig(provider, config)
    const apiKey = resolveProviderApiKeyFromConfig(provider, config)
    const result = await testProviderConnection(settings, apiKey)

    providerHealthCache[provider] = {
      ok: result.ok,
      message: result.message,
      checked_at: new Date().toISOString(),
      stages: result.stages,
    }
    await saveProviderHealthToDb(providerHealthCache)

    return {
      provider,
      ok: result.ok,
      message: result.message,
      checked_at: providerHealthCache[provider]?.checked_at,
      stages: result.stages,
    }
  })
}
