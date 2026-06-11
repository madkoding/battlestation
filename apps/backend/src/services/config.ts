import { getDb, saveDb } from '../db/sqlite-client'
import { encrypt, decrypt } from './crypto'

interface LLMProvider {
  model?: string
  base_url?: string
  api_key?: string
  verify_tls?: boolean
  profile?: 'local' | 'cloud'
}

interface AgentConfig {
  provider: string
  model: string
  temperature: number
  top_p: number
  max_tokens: number
}

interface Config {
  mode: 'local' | 'remote'
  database: { url: string }
  llm: {
    providers: Record<string, LLMProvider>
    default_provider: string
  }
  agents: Record<string, AgentConfig>
  server: { port: number; cors_origins: string[] }
  _encrypted?: boolean
  _password?: string
}

const DEFAULT_CONFIG: Config = {
  mode: 'local',
  database: { url: '~/.kosmos/kosmos.db' },
  llm: {
    providers: {
      ollama: {
        model: 'minimax-m2.7',
        base_url: 'http://127.0.0.1:11434/v1',
        api_key: '',
        verify_tls: true,
        profile: 'cloud',
      },
      openai: {
        model: 'gpt-4o-mini',
        base_url: 'https://api.openai.com/v1',
        api_key: '',
        verify_tls: true,
        profile: 'cloud',
      },
      github_copilot: {
        model: 'gpt-4o-mini',
        base_url: 'https://api.githubcopilot.com',
        api_key: '',
        verify_tls: true,
        profile: 'cloud',
      },
      anthropic: {
        model: 'claude-3-5-sonnet-latest',
        base_url: 'https://api.anthropic.com',
        api_key: '',
        verify_tls: true,
        profile: 'cloud',
      },
    },
    default_provider: 'ollama',
  },
  agents: {
    kosmos: { provider: 'ollama', model: 'minimax-m2.7', temperature: 0.2, top_p: 0.9, max_tokens: 16384 },
    vicks: { provider: 'ollama', model: 'minimax-m2.7', temperature: 0.2, top_p: 0.9, max_tokens: 16384 },
    wedge: { provider: 'ollama', model: 'minimax-m2.7', temperature: 0.2, top_p: 0.9, max_tokens: 16384 },
  },
  server: { port: 18792, cors_origins: ['*'] },
}

let cachedConfig: Config | null = null
let unlocked = false

function sanitizeInlineApiKey(value: string | undefined): string {
  const token = String(value || '').trim()
  if (!token) return ''

  // Never keep env-var aliases or clearly malformed payloads as raw secrets
  if (/^[A-Z][A-Z0-9_]*$/.test(token)) return ''
  if (token.includes('[plugin:vite:oxc]')) return ''
  if (token.length > 256) return ''
  if (/\s/.test(token)) return ''
  if (/[^\x20-\x7E]/.test(token)) return ''

  return token
}

function normalizeConfig(input: Config): Config {
  const providers = { ...(input.llm?.providers || {}) }
  let changed = false

  for (const [providerId, provider] of Object.entries(providers)) {
    const sanitizedApiKey = sanitizeInlineApiKey(provider.api_key)
    if (sanitizedApiKey !== String(provider.api_key || '')) {
      providers[providerId] = { ...provider, api_key: sanitizedApiKey }
      changed = true
    }
  }

  if (!changed) {
    const defaultProviderCandidate = String(input.llm?.default_provider || '').trim()
    const defaultProvider = defaultProviderCandidate && providers[defaultProviderCandidate]
      ? defaultProviderCandidate
      : DEFAULT_CONFIG.llm.default_provider
    const defaultModel = String(
      providers[defaultProvider]?.model
      || DEFAULT_CONFIG.llm.providers[defaultProvider]?.model
      || DEFAULT_CONFIG.agents.kosmos.model
    )

    const currentAgents = input.agents || DEFAULT_CONFIG.agents
    const normalizedAgents = {
      kosmos: {
        ...(currentAgents.kosmos || DEFAULT_CONFIG.agents.kosmos),
        provider: defaultProvider,
        model: defaultModel,
      },
      vicks: {
        ...(currentAgents.vicks || DEFAULT_CONFIG.agents.vicks),
        provider: defaultProvider,
        model: defaultModel,
      },
      wedge: {
        ...(currentAgents.wedge || DEFAULT_CONFIG.agents.wedge),
        provider: defaultProvider,
        model: defaultModel,
      },
    }

    const shouldReturnInput =
      defaultProvider === String(input.llm?.default_provider || '')
      && normalizedAgents.kosmos.provider === String(currentAgents.kosmos?.provider || '')
      && normalizedAgents.kosmos.model === String(currentAgents.kosmos?.model || '')
      && normalizedAgents.vicks.provider === String(currentAgents.vicks?.provider || '')
      && normalizedAgents.vicks.model === String(currentAgents.vicks?.model || '')
      && normalizedAgents.wedge.provider === String(currentAgents.wedge?.provider || '')
      && normalizedAgents.wedge.model === String(currentAgents.wedge?.model || '')

    if (shouldReturnInput) {
      return input
    }

    return {
      ...input,
      llm: {
        ...input.llm,
        default_provider: defaultProvider,
        providers,
      },
      agents: normalizedAgents,
    }
  }

  const defaultProviderCandidate = String(input.llm?.default_provider || '').trim()
  const defaultProvider = defaultProviderCandidate && providers[defaultProviderCandidate]
    ? defaultProviderCandidate
    : DEFAULT_CONFIG.llm.default_provider
  const defaultModel = String(
    providers[defaultProvider]?.model
    || DEFAULT_CONFIG.llm.providers[defaultProvider]?.model
    || DEFAULT_CONFIG.agents.kosmos.model
  )
  const currentAgents = input.agents || DEFAULT_CONFIG.agents

  return {
    ...input,
    llm: {
      ...input.llm,
      default_provider: defaultProvider,
      providers,
    },
    agents: {
      kosmos: {
        ...(currentAgents.kosmos || DEFAULT_CONFIG.agents.kosmos),
        provider: defaultProvider,
        model: defaultModel,
      },
      vicks: {
        ...(currentAgents.vicks || DEFAULT_CONFIG.agents.vicks),
        provider: defaultProvider,
        model: defaultModel,
      },
      wedge: {
        ...(currentAgents.wedge || DEFAULT_CONFIG.agents.wedge),
        provider: defaultProvider,
        model: defaultModel,
      },
    },
  }
}

export async function getConfig(): Promise<Config> {
  if (cachedConfig) return cachedConfig

  const db = await getDb()
  const result = db.exec("SELECT value FROM config_store WHERE key = 'main'")
  if (result.length && result[0].values.length) {
    try {
      const raw = result[0].values[0][0] as string
      const parsed = JSON.parse(raw) as Config
      const normalized = normalizeConfig(parsed)
      cachedConfig = normalized
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        await saveConfig(normalized)
      }
      return cachedConfig
    } catch {
      cachedConfig = DEFAULT_CONFIG
    }
  }

  cachedConfig = DEFAULT_CONFIG
  await saveConfig(DEFAULT_CONFIG)
  return DEFAULT_CONFIG
}

export async function updateConfig(partial: Partial<Config>): Promise<Config> {
  const current = await getConfig()
  const updated = normalizeConfig({ ...current, ...partial } as Config)
  await saveConfig(updated)
  cachedConfig = updated
  return updated
}

export async function saveConfig(config: Config) {
  const db = await getDb()
  const existing = db.exec("SELECT key FROM config_store WHERE key = 'main'")

  if (existing.length && existing[0].values.length) {
    db.run(`UPDATE config_store SET value = ? WHERE key = 'main'`, [JSON.stringify(config)])
  } else {
    db.run(`INSERT INTO config_store (key, value) VALUES ('main', ?)`, [JSON.stringify(config)])
  }

  saveDb(db)
}

export async function unlockConfig(password: string): Promise<boolean> {
  const config = await getConfig()

  if (config._encrypted && config._password) {
    try {
      const decrypted = decrypt(config._password, password)
      const decryptedConfig = JSON.parse(decrypted)
      cachedConfig = { ...decryptedConfig, _encrypted: true, _password: config._password }
      unlocked = true
      return true
    } catch {
      return false
    }
  }

  unlocked = true
  return true
}

export async function lockConfig(): Promise<void> {
  unlocked = false
}

export function isUnlocked(): boolean {
  return unlocked
}

export async function encryptConfig(password: string): Promise<Config> {
  const config = await getConfig()
  const encrypted = encrypt(JSON.stringify(config), password)

  const protectedConfig: Config = {
    ...DEFAULT_CONFIG,
    _encrypted: true,
    _password: encrypted,
  }

  await saveConfig(protectedConfig)
  cachedConfig = protectedConfig
  return protectedConfig
}

export async function getConfigWithSecrets(): Promise<Config> {
  const config = await getConfig()

  if (config._encrypted && !unlocked) {
    return { ...DEFAULT_CONFIG, _encrypted: true }
  }

  return config
}
