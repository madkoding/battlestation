import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DEFAULT_RUNTIME_POLICY, loadRuntimePolicy } from '@kosmos/shared'
import type { PolicyTarget, RuntimePolicy } from '@kosmos/shared'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CACHE_TTL_MS = 5000

interface CacheEntry {
  policy: RuntimePolicy
  expiresAt: number
}

const policyCache = new Map<PolicyTarget, CacheEntry>()

function resolveProfilesRoot(): string {
  const agentSrcDir = join(__dirname, '..')
  const projectRoot = join(agentSrcDir, '..', '..')
  const candidates = [
    join(projectRoot, 'config', 'profiles'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

function fallbackPolicy(target: PolicyTarget): RuntimePolicy {
  return {
    ...DEFAULT_RUNTIME_POLICY,
    agent: target,
  }
}

export function getRuntimePolicy(target: PolicyTarget): RuntimePolicy {
  const cached = policyCache.get(target)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.policy
  }

  let policy: RuntimePolicy
  try {
    policy = loadRuntimePolicy({
      profilesRoot: resolveProfilesRoot(),
      target,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[policy] Failed loading policy for ${target}: ${message}`)
    policy = fallbackPolicy(target)
  }

  policyCache.set(target, {
    policy,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return policy
}

export function clearRuntimePolicyCache() {
  policyCache.clear()
}
