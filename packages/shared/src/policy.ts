import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { z } from 'zod'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (value: string) => unknown }

export const PolicyTargetSchema = z.enum(['global', 'kosmos', 'vicks', 'wedge'])
export type PolicyTarget = z.infer<typeof PolicyTargetSchema>

const PriorityLabelSchema = z.enum(['low', 'medium', 'high'])

export const DEFAULT_FRONTEND_TASK_PATTERN = /\bfrontend\b|\bux\b|\breact\b|\bvite\b|\bnext\b|\btailwind\b|\bcss\b|\bhtml\b|\bcomponent(s)?\b|\blayout\b|\bresponsive\b|\bdashboard\b|\bmodal\b|\bkanban\b|\bscreenshot(s)?\b|\bplaywright\b|\buser interface\b|\bui shell\b|\bnavigation\b/.source
export const DEFAULT_DOCUMENTATION_TASK_PATTERN = /release|deployment|deploy|documentation|docs|runbook|handoff|contribution/.source
export const DEFAULT_QA_REJECTION_PATTERN = /reject|cannot approve|failed|return to development/.source
export const DEFAULT_QA_HINT_PATTERN = /required|next action|blocking|root cause|deliverables|port|playwright|screenshot|diff|changed files|commit/.source

const AgentTuningSchema = z.object({
  temperature: z.number().min(0).max(2),
  top_p: z.number().min(0.01).max(1),
  max_tokens: z.number().int().min(512).max(131072),
})

const TuningPresetSchema = z.object({
  kosmos: AgentTuningSchema,
  vicks: AgentTuningSchema,
  wedge: AgentTuningSchema,
})

export const RuntimePolicySchema = z.object({
  version: z.number().int().min(1).default(1),
  agent: PolicyTargetSchema.default('global'),
  classification: z.object({
    frontend_task_pattern: z.string().default(DEFAULT_FRONTEND_TASK_PATTERN),
    documentation_task_pattern: z.string().default(DEFAULT_DOCUMENTATION_TASK_PATTERN),
  }).default({
    frontend_task_pattern: DEFAULT_FRONTEND_TASK_PATTERN,
    documentation_task_pattern: DEFAULT_DOCUMENTATION_TASK_PATTERN,
  }),
  delivery_gate: z.object({
    require_code_delta: z.boolean().default(true),
    require_tests_for_non_documentation: z.boolean().default(true),
    skip_placeholder_test_script: z.boolean().default(true),
    placeholder_test_script_pattern: z.string().default('no test specified'),
    require_frontend_qa_evidence: z.boolean().default(true),
    blocked_comment_marker: z.string().default('## Delivery Gate Blocked'),
    escalation_comment_marker: z.string().default('## Delivery Escalation Required'),
  }).default({
    require_code_delta: true,
    require_tests_for_non_documentation: true,
    skip_placeholder_test_script: true,
    placeholder_test_script_pattern: 'no test specified',
    require_frontend_qa_evidence: true,
    blocked_comment_marker: '## Delivery Gate Blocked',
    escalation_comment_marker: '## Delivery Escalation Required',
  }),
  context: z.object({
    window_tokens: z.number().int().min(32000).default(128000),
    input_budget_ratio: z.number().min(0.35).max(0.95).default(0.72),
  }).default({
    window_tokens: 128000,
    input_budget_ratio: 0.72,
  }),
  handoff: z.object({
    max_retry_before_block: z.number().int().min(1).default(3),
    max_requeue_before_pause: z.number().int().min(1).default(8),
    max_closure_comment_chars: z.number().int().min(400).max(12000).default(3500),
  }).default({
    max_retry_before_block: 3,
    max_requeue_before_pause: 8,
    max_closure_comment_chars: 3500,
  }),
  planning: z.object({
    max_commands: z.number().int().min(1).default(4),
    max_checks: z.number().int().min(0).default(2),
    max_structured_ops: z.number().int().min(1).default(8),
    max_effective_commands: z.number().int().min(1).default(8),
  }).default({
    max_commands: 4,
    max_checks: 2,
    max_structured_ops: 8,
    max_effective_commands: 8,
  }),
  qa: z.object({
    approval_keywords: z.array(z.string().min(1)).min(1).default(['approved', 'looks good', 'passes', 'lgtm']),
    auth_error_initial_backoff_ms: z.number().int().min(1000).default(120000),
    auth_error_max_backoff_ms: z.number().int().min(1000).default(600000),
    auth_error_pause_comment_marker: z.string().default('## QA Paused (Infra)'),
  }).default({
    approval_keywords: ['approved', 'looks good', 'passes', 'lgtm'],
    auth_error_initial_backoff_ms: 120000,
    auth_error_max_backoff_ms: 600000,
    auth_error_pause_comment_marker: '## QA Paused (Infra)',
  }),
  review: z.object({
    qa_rejection_pattern: z.string().default(DEFAULT_QA_REJECTION_PATTERN),
    qa_issue_hint_pattern: z.string().default(DEFAULT_QA_HINT_PATTERN),
  }).default({
    qa_rejection_pattern: DEFAULT_QA_REJECTION_PATTERN,
    qa_issue_hint_pattern: DEFAULT_QA_HINT_PATTERN,
  }),
  loop: z.object({
    idle_sleep_ms: z.number().int().min(250).default(5000),
    error_sleep_ms: z.number().int().min(250).default(5000),
    escalation_sleep_ms: z.number().int().min(250).default(20000),
  }).default({
    idle_sleep_ms: 5000,
    error_sleep_ms: 5000,
    escalation_sleep_ms: 20000,
  }),
  orchestration: z.object({
    poll_interval_ms: z.number().int().min(500).default(5000),
    recovery_cooldown_ms: z.number().int().min(1000).default(120000),
    progress_stale_ms: z.number().int().min(1000).default(180000),
    qa_stale_ms: z.number().int().min(1000).default(120000),
    escalated_task_cooldown_ms: z.number().int().min(1000).default(120000),
    cooldown_activity_throttle_ms: z.number().int().min(1000).default(60000),
    priority_order: z.array(PriorityLabelSchema).min(1).default(['high', 'medium', 'low']),
  }).default({
    poll_interval_ms: 5000,
    recovery_cooldown_ms: 120000,
    progress_stale_ms: 180000,
    qa_stale_ms: 120000,
    escalated_task_cooldown_ms: 120000,
    cooldown_activity_throttle_ms: 60000,
    priority_order: ['high', 'medium', 'low'],
  }),
  runtime_bootstrap: z.object({
    node_dev_dependencies: z.array(z.string()).default(['vitest', 'typescript', '@types/node', '@playwright/test', 'playwright']),
    frontend_extra_dev_dependencies: z.array(z.string()).default(['vite']),
    ensure_scripts: z.object({
      test: z.string().default('vitest run'),
      typecheck: z.string().default('tsc --noEmit'),
      frontend_dev: z.string().default('vite --host 127.0.0.1 --port 5173'),
    }).default({
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      frontend_dev: 'vite --host 127.0.0.1 --port 5173',
    }),
    playwright_install_command: z.string().default('npx playwright install chromium'),
  }).default({
    node_dev_dependencies: ['vitest', 'typescript', '@types/node', '@playwright/test', 'playwright'],
    frontend_extra_dev_dependencies: ['vite'],
    ensure_scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      frontend_dev: 'vite --host 127.0.0.1 --port 5173',
    },
    playwright_install_command: 'npx playwright install chromium',
  }),
  settings: z.object({
    tuning_presets: z.object({
      strict: TuningPresetSchema,
      balanced: TuningPresetSchema,
      exploratory: TuningPresetSchema,
    }).default({
      strict: {
        kosmos: { temperature: 0.15, top_p: 0.85, max_tokens: 16384 },
        vicks: { temperature: 0.2, top_p: 0.9, max_tokens: 24576 },
        wedge: { temperature: 0.1, top_p: 0.8, max_tokens: 16384 },
      },
      balanced: {
        kosmos: { temperature: 0.22, top_p: 0.9, max_tokens: 16384 },
        vicks: { temperature: 0.3, top_p: 0.92, max_tokens: 32768 },
        wedge: { temperature: 0.18, top_p: 0.88, max_tokens: 24576 },
      },
      exploratory: {
        kosmos: { temperature: 0.32, top_p: 0.95, max_tokens: 24576 },
        vicks: { temperature: 0.45, top_p: 0.96, max_tokens: 49152 },
        wedge: { temperature: 0.25, top_p: 0.92, max_tokens: 32768 },
      },
    }),
  }).default({
    tuning_presets: {
      strict: {
        kosmos: { temperature: 0.15, top_p: 0.85, max_tokens: 16384 },
        vicks: { temperature: 0.2, top_p: 0.9, max_tokens: 24576 },
        wedge: { temperature: 0.1, top_p: 0.8, max_tokens: 16384 },
      },
      balanced: {
        kosmos: { temperature: 0.22, top_p: 0.9, max_tokens: 16384 },
        vicks: { temperature: 0.3, top_p: 0.92, max_tokens: 32768 },
        wedge: { temperature: 0.18, top_p: 0.88, max_tokens: 24576 },
      },
      exploratory: {
        kosmos: { temperature: 0.32, top_p: 0.95, max_tokens: 24576 },
        vicks: { temperature: 0.45, top_p: 0.96, max_tokens: 49152 },
        wedge: { temperature: 0.25, top_p: 0.92, max_tokens: 32768 },
      },
    },
  }),
})

export type RuntimePolicy = z.infer<typeof RuntimePolicySchema>

export const DEFAULT_RUNTIME_POLICY: RuntimePolicy = RuntimePolicySchema.parse({})

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (!keys.length) return

  let cursor: Record<string, unknown> = target
  for (const key of keys.slice(0, -1)) {
    const existing = cursor[key]
    if (!isRecord(existing)) {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }

  cursor[keys[keys.length - 1]] = value
}

function parseScalar(rawValue: string): unknown {
  const value = rawValue.trim()
  if (!value) return ''

  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1)
  }

  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true'
  }

  if (/^(null|~)$/i.test(value)) {
    return null
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return value
}

export function extractFrontmatter(markdown: string): string {
  const text = String(markdown || '')
  const match = text.match(FRONTMATTER_RE)
  return String(match?.[1] || '').trim()
}

function parseKeyValueFrontmatter(frontmatter: string): Record<string, unknown> {
  const target: Record<string, unknown> = {}
  const lines = String(frontmatter || '').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/)
    if (!match) continue
    const key = match[1].trim()
    const value = parseScalar(match[2])
    setByPath(target, key, value)
  }
  return target
}

export function parsePolicyMarkdown(markdown: string): Record<string, unknown> {
  const frontmatter = extractFrontmatter(markdown)
  if (!frontmatter) return {}

  try {
    const parsedYaml = yaml.load(frontmatter)
    if (isRecord(parsedYaml)) {
      return parsedYaml
    }
  } catch {
    // fallback to JSON / key-value parser below
  }

  try {
    const asJson = JSON.parse(frontmatter)
    if (isRecord(asJson)) {
      return asJson
    }
  } catch {
    // fallback to key-value parser below
  }

  return parseKeyValueFrontmatter(frontmatter)
}

export function deepMergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  for (const [key, overrideValue] of Object.entries(override || {})) {
    const baseValue = next[key]
    if (isRecord(baseValue) && isRecord(overrideValue)) {
      next[key] = deepMergeRecords(baseValue, overrideValue)
      continue
    }
    next[key] = overrideValue
  }
  return next
}

export function resolveRuntimePolicy(parts: Array<Record<string, unknown>>): RuntimePolicy {
  let merged = structuredClone(DEFAULT_RUNTIME_POLICY) as Record<string, unknown>
  for (const part of parts) {
    if (!isRecord(part)) continue
    merged = deepMergeRecords(merged, part)
  }
  return RuntimePolicySchema.parse(merged)
}

export function loadRuntimePolicy(params: { profilesRoot: string; target: PolicyTarget }): RuntimePolicy {
  const { profilesRoot, target } = params
  const files = [
    join(profilesRoot, 'POLICY.md'),
    target === 'global' ? '' : join(profilesRoot, target, 'POLICY.md'),
  ].filter(Boolean)

  const parts: Array<Record<string, unknown>> = []
  for (const filePath of files) {
    if (!existsSync(filePath)) continue
    const markdown = readFileSync(filePath, 'utf-8')
    parts.push(parsePolicyMarkdown(markdown))
  }

  const resolved = resolveRuntimePolicy(parts)
  return RuntimePolicySchema.parse({ ...resolved, agent: target })
}

export function compilePolicyRegex(pattern: string, fallback: RegExp): RegExp {
  try {
    const normalized = String(pattern || '').trim()
    if (!normalized) return fallback
    return new RegExp(normalized, 'i')
  } catch {
    return fallback
  }
}
