import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DEFAULT_RUNTIME_POLICY, loadRuntimePolicy, POLICY_CACHE_TTL_MS } from '@kosmos/shared'
import type { PolicyTarget, RuntimePolicy } from '@kosmos/shared'
import { logger } from '../lib/logger'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CacheEntry {
  policy: RuntimePolicy
  expiresAt: number
}

const policyCache = new Map<PolicyTarget, CacheEntry>()

function resolveProfilesRoot(): string {
  const backendSrcDir = join(__dirname, '..')
  const projectRoot = join(backendSrcDir, '..', '..')
  return join(projectRoot, 'config', 'profiles')
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Failed loading policy for ${target}: ${message}`)
    policy = fallbackPolicy(target)
  }

  policyCache.set(target, {
    policy,
    expiresAt: Date.now() + POLICY_CACHE_TTL_MS,
  })

  return policy
}

export function clearRuntimePolicyCache() {
  policyCache.clear()
}
