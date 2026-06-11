import { asRecord, compilePolicyRegex, DEFAULT_POLL_MS } from '@kosmos/shared'
import type { RuntimePolicy } from '@kosmos/shared'
import { join } from 'path'
import { getRuntimePolicy } from './policy'

const PROJECT_INSTRUCTIONS_MAX_CHARS = 12000

export type AgentRecord = ReturnType<typeof asRecord>
export type TaskRecord = Record<string, unknown>
export type ProjectRecord = Record<string, unknown>
export type CommentRecord = Record<string, unknown>
export type PlanOp = { tool: string; args: AgentRecord }

export interface QaEvidencePayload {
  executed?: boolean
  reason?: string
  base_url?: string
  script?: string
  screenshots?: Array<{ path?: string; url?: string; viewport?: string }>
  logs?: string[]
}

export interface WorktreeArtifacts {
  exists?: boolean
  changed_files?: string[]
  recent_commits?: string[]
  files_between_branches?: string[]
}

export interface WorkspaceExecResult {
  ok?: boolean
  stdout?: string
  stderr?: string
}

export interface QaScreenshotRef {
  evidenceId: string
  index: number
  path: string
  viewport: string
  url: string
  apiUrl: string
}

export interface Profile {
  model: string
  provider: string
  base_url: string
  api_key: string
  temperature: number
  top_p: number
  max_tokens: number
  systemPrompt: string
  [key: string]: unknown
}

const DEFAULT_FRONTEND_TASK_REGEX = /\bfrontend\b|\bux\b|\breact\b|\bvite\b|\bnext\b|\btailwind\b|\bcss\b|\bhtml\b|\bcomponent(s)?\b|\blayout\b|\bresponsive\b|\bdashboard\b|\bmodal\b|\bkanban\b|\bscreenshot(s)?\b|\bplaywright\b|\buser interface\b|\bui shell\b|\bnavigation\b/i
const DEFAULT_DOCUMENTATION_TASK_REGEX = /release|deployment|deploy|documentation|docs|runbook|handoff|contribution/i
const DEFAULT_QA_REJECTION_REGEX = /reject|cannot approve|failed|return to development/i
const DEFAULT_QA_HINT_REGEX = /required|next action|blocking|root cause|deliverables|port|playwright|screenshot|diff|changed files|commit/i

export function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

export function asWorkspaceExecResult(value: unknown): WorkspaceExecResult {
  const raw = asRecord(value)
  return {
    ok: typeof raw.ok === 'boolean' ? raw.ok : undefined,
    stdout: raw.stdout === undefined ? undefined : String(raw.stdout),
    stderr: raw.stderr === undefined ? undefined : String(raw.stderr),
  }
}

export function asWorktreeArtifacts(value: unknown): WorktreeArtifacts | null {
  const raw = asRecord(value)
  if (Object.keys(raw).length === 0) return null

  const changedFiles = asStringArray(raw.changed_files)
  const recentCommits = asStringArray(raw.recent_commits)
  const filesBetweenBranches = asStringArray(raw.files_between_branches)

  return {
    exists: typeof raw.exists === 'boolean' ? raw.exists : undefined,
    changed_files: changedFiles.length > 0 ? changedFiles : undefined,
    recent_commits: recentCommits.length > 0 ? recentCommits : undefined,
    files_between_branches: filesBetweenBranches.length > 0 ? filesBetweenBranches : undefined,
  }
}

export function asQaEvidencePayload(value: unknown): QaEvidencePayload | null {
  const raw = asRecord(value)
  if (Object.keys(raw).length === 0) return null

  const screenshots = asUnknownArray(raw.screenshots).reduce<Array<{ path?: string; url?: string; viewport?: string }>>((acc, item) => {
    const shot = asRecord(item)
    const path = String(shot.path || '').trim()
    const url = String(shot.url || '').trim()
    const viewport = String(shot.viewport || '').trim()
    if (!path && !url && !viewport) return acc
    acc.push({
      path: path || undefined,
      url: url || undefined,
      viewport: viewport || undefined,
    })
    return acc
  }, [])

  const logs = asStringArray(raw.logs)

  return {
    executed: typeof raw.executed === 'boolean' ? raw.executed : undefined,
    reason: raw.reason === undefined ? undefined : String(raw.reason),
    base_url: raw.base_url === undefined ? undefined : String(raw.base_url),
    script: raw.script === undefined ? undefined : String(raw.script),
    screenshots: screenshots.length > 0 ? screenshots : undefined,
    logs: logs.length > 0 ? logs : undefined,
  }
}

export function asTaskRecordArray(value: unknown): TaskRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asRecord(item))
}

export function asProjectRecordArray(value: unknown): ProjectRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asRecord(item))
}

export function asCommentRecordArray(value: unknown): CommentRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asRecord(item))
}

export function taskSortTimestamp(task: TaskRecord): number {
  const raw = String(task.updated_at || task.created_at || '')
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function estimateTokenCount(text: string): number {
  const value = String(text || '')
  if (!value) return 0
  return Math.ceil(value.length / 4)
}

export function getInputBudget(profile: Profile, policy: RuntimePolicy): number {
  const contextWindowTokens = Number(policy.context.window_tokens || 128000)
  const contextInputBudgetRatio = Number(policy.context.input_budget_ratio || 0.72)
  const reserve = Math.max(2048, Math.min(Number(profile.max_tokens || 8192), 32768))
  const budget = Math.floor(contextWindowTokens * contextInputBudgetRatio) - reserve
  return Math.max(8000, budget)
}

export function compactFreeText(text: string, maxTokens: number): string {
  const source = String(text || '')
  if (!source.trim()) return ''
  if (estimateTokenCount(source) <= maxTokens) return source

  const lines = source.split('\n').filter((line) => line.trim().length > 0)
  if (!lines.length) return source.slice(0, maxTokens * 4)

  const headCount = Math.max(8, Math.floor(lines.length * 0.4))
  const tailCount = Math.max(8, Math.floor(lines.length * 0.4))
  const head = lines.slice(0, headCount)
  const tail = lines.slice(Math.max(headCount, lines.length - tailCount))
  const merged = [
    ...head,
    `[context compacted: ${lines.length - head.length - tail.length} lines omitted to stay under token budget]`,
    ...tail,
  ].join('\n')

  if (estimateTokenCount(merged) <= maxTokens) return merged
  return merged.slice(0, maxTokens * 4)
}

export function compactProjectInstructions(text: string, maxChars = PROJECT_INSTRUCTIONS_MAX_CHARS): string {
  const source = String(text || '').trim()
  if (!source) return ''
  const cap = Math.max(800, Number(maxChars || PROJECT_INSTRUCTIONS_MAX_CHARS))
  if (source.length <= cap) return source

  const head = source.slice(0, Math.floor(cap * 0.72)).trimEnd()
  const tail = source.slice(-Math.floor(cap * 0.2)).trimStart()
  return `${head}\n\n[project instructions compacted]\n\n${tail}`
}

export function compactCommentsForPrompt(comments: CommentRecord[], maxTokens: number): string {
  if (!Array.isArray(comments) || comments.length === 0) return '- none'

  const serialize = (comment: CommentRecord) => {
    const agent = String(comment?.agent_name || 'unknown')
    const at = String(comment?.created_at || '').slice(0, 19)
    const body = String(comment?.comment || '').trim()
    return `[${agent}${at ? ` @ ${at}` : ''}]: ${body}`
  }

  const full = comments.map(serialize).join('\n')
  if (estimateTokenCount(full) <= maxTokens) return full

  const recent = comments.slice(-10).map(serialize)
  const older = comments.slice(0, -10)
  const compressedOlder = older.map((comment) => {
    const agent = String(comment?.agent_name || 'unknown')
    const at = String(comment?.created_at || '').slice(0, 19)
    const body = String(comment?.comment || '').replace(/\s+/g, ' ').trim()
    const headline = body.split('\n').map((line) => line.trim()).find((line) => line.length > 0) || body.slice(0, 160)
    return `[${agent}${at ? ` @ ${at}` : ''}]: ${headline.slice(0, 180)} [compacted]`
  })

  const candidate = [
    '[older context compacted]',
    ...compressedOlder.slice(-24),
    '[recent context]'
  , ...recent,
  ].join('\n')

  return compactFreeText(candidate, maxTokens)
}

export function trimToCommentLimit(text: string, maxChars: number): string {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  const limit = Math.max(400, Number(maxChars || 3500))
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit)}\n\n[truncated]`
}

export function extractHeadline(text: string, fallback: string): string {
  const firstNonEmpty = String(text || '')
    .split('\n')
    .map((line) => line.replace(/^[-#*\s]+/, '').trim())
    .find((line) => line.length > 0)
  return (firstNonEmpty || fallback).slice(0, 180)
}

export function countQaRejections(comments: CommentRecord[]): number {
  const policy = getRuntimePolicy('vicks')
  const rejectionPattern = compilePolicyRegex(
    policy.review.qa_rejection_pattern,
    DEFAULT_QA_REJECTION_REGEX,
  )
  return comments.filter((c) => {
    const agent = String(c?.agent_name || '').toLowerCase()
    const text = String(c?.comment || '')
    return agent === 'wedge' && rejectionPattern.test(text)
  }).length
}

export function countDeliveryGateBlocks(comments: CommentRecord[], marker: string): number {
  const safeMarker = String(marker || '## Delivery Gate Blocked')
  return comments.filter((c) => {
    const agent = String(c?.agent_name || '').toLowerCase()
    const text = String(c?.comment || '')
    return agent === 'vicks' && text.includes(safeMarker)
  }).length
}

export function collectQaIssueHints(comments: CommentRecord[]): string[] {
  const policy = getRuntimePolicy('vicks')
  const hintPattern = compilePolicyRegex(
    policy.review.qa_issue_hint_pattern,
    DEFAULT_QA_HINT_REGEX,
  )
  const wedgeNotes = comments
    .filter((c) => String(c?.agent_name || '').toLowerCase() === 'wedge')
    .slice(-6)
    .map((c) => String(c?.comment || ''))

  const hints: string[] = []
  for (const note of wedgeNotes) {
    const lines = note.split('\n')
    for (const line of lines) {
      const cleaned = line.replace(/^[-*\d.)\s]+/, '').trim()
      if (!cleaned) continue
      if (hintPattern.test(cleaned)) {
        hints.push(cleaned)
      }
    }
  }
  return Array.from(new Set(hints)).slice(0, 12)
}

export function isTestCommand(command: string): boolean {
  const cmd = String(command || '').toLowerCase()
  return /(^|\s)(npm|pnpm|yarn|bun)\s+run\s+test(\s|$)|(^|\s)(npx\s+)?(vitest|jest|playwright\s+test)(\s|$)|(^|\s)pytest(\s|$)|(^|\s)go\s+test(\s|$)|(^|\s)cargo\s+test(\s|$)|(^|\s)(mvn|gradle)\s+test(\s|$)/.test(cmd)
}

export function isInstallCommand(command: string): boolean {
  const cmd = String(command || '').toLowerCase()
  return /(^|\s)(npm|pnpm|yarn|bun)\s+(install|i|add)(\s|$)|(^|\s)npm\s+init\b|(^|\s)pip\s+install(\s|$)|(^|\s)playwright\s+install(\s|$)/.test(cmd)
}

export function isDocumentationOnlyTask(task: TaskRecord, documentationPattern: RegExp): boolean {
  const corpus = [
    String(task?.title || ''),
    String(task?.description || ''),
  ].join(' ').toLowerCase()
  return documentationPattern.test(corpus)
}

export function normalizePlanOps(rawOps: unknown[], maxOps: number): PlanOp[] {
  if (!Array.isArray(rawOps)) return []
  const allowed = new Set(['list', 'read', 'write', 'edit', 'move', 'delete', 'glob', 'search'])
  const ops: PlanOp[] = []
  const cap = Math.max(1, Number(maxOps || 8))
  for (const raw of rawOps) {
    const item = asRecord(raw)
    const tool = String(item.tool || '').trim().toLowerCase()
    if (!allowed.has(tool)) continue
    const args = asRecord(item.args)
    ops.push({ tool, args })
    if (ops.length >= cap) break
  }
  return ops
}

export function buildTaskClassifiers(policy: RuntimePolicy): { frontend: RegExp; documentation: RegExp } {
  return {
    frontend: compilePolicyRegex(policy.classification.frontend_task_pattern, DEFAULT_FRONTEND_TASK_REGEX),
    documentation: compilePolicyRegex(policy.classification.documentation_task_pattern, DEFAULT_DOCUMENTATION_TASK_REGEX),
  }
}

export function getLoopSleepMs(policy: RuntimePolicy): { idle: number; error: number; escalation: number } {
  const idle = Math.max(250, Number(policy.loop.idle_sleep_ms || DEFAULT_POLL_MS))
  const error = Math.max(250, Number(policy.loop.error_sleep_ms || DEFAULT_POLL_MS))
  const escalation = Math.max(250, Number(policy.loop.escalation_sleep_ms || 20000))
  return { idle, error, escalation }
}

export function formatArtifactsForPrompt(artifacts: {
  exists?: boolean
  changed_files?: string[]
  recent_commits?: string[]
  files_between_branches?: string[]
} | null | undefined): string {
  if (!artifacts?.exists) {
    return 'Worktree not found or not available.'
  }

  const changed = Array.isArray(artifacts.changed_files) && artifacts.changed_files.length
    ? artifacts.changed_files.map((file) => `- ${file}`).join('\n')
    : '- None detected from git status'

  const commits = Array.isArray(artifacts.recent_commits) && artifacts.recent_commits.length
    ? artifacts.recent_commits.map((line) => `- ${line}`).join('\n')
    : '- No recent commits detected'

  const betweenBranches = Array.isArray(artifacts.files_between_branches) && artifacts.files_between_branches.length
    ? artifacts.files_between_branches.map((file) => `- ${file}`).join('\n')
    : '- Not available or no changes detected between base/work branches'

  const changedCount = Array.isArray(artifacts.changed_files) ? artifacts.changed_files.length : 0
  const betweenCount = Array.isArray(artifacts.files_between_branches) ? artifacts.files_between_branches.length : 0
  const commitsCount = Array.isArray(artifacts.recent_commits) ? artifacts.recent_commits.length : 0
  const worktreeExists = artifacts.exists ? 'yes' : 'no'

  return [
    'Evidence quality:',
    `- worktree_exists: ${worktreeExists}`,
    `- changed_files_count: ${changedCount}`,
    `- branch_diff_count: ${betweenCount}`,
    `- recent_commits_count: ${commitsCount}`,
    '',
    'Changed files:',
    changed,
    '',
    'Files changed between base and work branch:',
    betweenBranches,
    '',
    'Recent commits:',
    commits,
  ].join('\n')
}

export function resolveWorktreePath(task: TaskRecord): string {
  const workspace = String(task.workspace_path || '').trim()
  const branch = String(task.work_branch || '').trim()
  if (!workspace) return ''
  if (!branch) return workspace
  return join(workspace, '.worktrees', branch)
}

export function isLikelyFrontendTask(task: TaskRecord, frontendPattern: RegExp, documentationPattern: RegExp): boolean {
  const corpus = [
    String(task?.title || ''),
    String(task?.description || ''),
  ].join(' ').toLowerCase()

  const isDeliveryOrDocs = documentationPattern.test(corpus)
  const frontendSignals = frontendPattern.test(corpus)
  if (isDeliveryOrDocs && !frontendSignals) return false
  return frontendSignals
}

export function getLatestQaEvidencePayload(entries: unknown[]): QaEvidencePayload | null {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const latest = asRecord(entries[0])
  const payload = asRecord(latest.payload)
  if (Object.keys(payload).length === 0) return null
  return payload as QaEvidencePayload
}

export function collectQaScreenshotRefs(taskId: string, entries: unknown[], maxItems = 4): QaScreenshotRef[] {
  const safeTaskId = String(taskId || '').trim()
  if (!safeTaskId || !Array.isArray(entries) || entries.length === 0) return []
  const cap = Math.max(1, Math.min(Number(maxItems || 4), 8))

  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry)
    const payload = asRecord(entry.payload)
    const evidenceId = String(entry.id || '').trim()
    const screenshots = Array.isArray(payload.screenshots)
      ? payload.screenshots
      : []
    if (!evidenceId || screenshots.length === 0) continue

    return screenshots.slice(0, cap).map((item, index) => {
      const shot = asRecord(item)
      const viewport = String(shot.viewport || 'capture').trim()
      const shotUrl = String(shot.url || '').trim()
      const shotPath = String(shot.path || '').trim()
      const apiUrl = `/api/tasks/${encodeURIComponent(safeTaskId)}/qa-evidence/${encodeURIComponent(evidenceId)}/screenshots/${index}`
      return {
        evidenceId,
        index,
        path: shotPath,
        viewport,
        url: shotUrl,
        apiUrl,
      }
    })
  }

  return []
}

export function formatQaScreenshotMarkdown(taskId: string, entries: unknown[]): string {
  const refs = collectQaScreenshotRefs(taskId, entries, 4)
  if (refs.length === 0) return ''

  return [
    '## QA Screenshots',
    ...refs.map((ref, idx) => `![QA ${ref.viewport || 'capture'} ${idx + 1}](${ref.apiUrl})`),
    '',
    '### Open Full Size',
    ...refs.map((ref, idx) => `- [${ref.viewport || 'capture'} ${idx + 1}](${ref.apiUrl})${ref.url ? ` (page: ${ref.url})` : ''}`),
  ].join('\n')
}

export function appendCommentSection(baseComment: string, sectionMarkdown: string, maxChars: number): string {
  const base = String(baseComment || '').trim()
  const section = String(sectionMarkdown || '').trim()
  if (!section) {
    return trimToCommentLimit(base, maxChars)
  }

  if (base.includes('## QA Screenshots')) {
    return trimToCommentLimit(base, maxChars)
  }

  const limit = Math.max(400, Number(maxChars || 3500))
  const fullCandidate = `${base}\n\n${section}`
  if (fullCandidate.length <= limit) {
    return fullCandidate
  }

  const lines = section.split('\n')
  let merged = base
  for (const line of ['', ...lines]) {
    const next = `${merged}\n${line}`
    if (next.length > limit) break
    merged = next
  }

  return trimToCommentLimit(merged, limit)
}

export function shouldRunFrontendQaEvidence(params: {
  policy: RuntimePolicy
  requiresFrontendEvidence: boolean
  worktreeArtifacts: {
    changed_files?: string[]
    files_between_branches?: string[]
    recent_commits?: string[]
  } | null
  latestQaEvidence: QaEvidencePayload | null
}): boolean {
  const { policy, requiresFrontendEvidence, worktreeArtifacts, latestQaEvidence } = params
  if (!policy.delivery_gate.require_frontend_qa_evidence) return false
  if (!requiresFrontendEvidence) return false

  const changedCount = worktreeArtifacts?.changed_files?.length || 0
  const branchDiffCount = worktreeArtifacts?.files_between_branches?.length || 0
  const hasCodeDelta = changedCount > 0 || branchDiffCount > 0
  if (!hasCodeDelta) return false

  const latestReason = String(latestQaEvidence?.reason || '').toLowerCase()
  const screenshots = Array.isArray(latestQaEvidence?.screenshots) ? latestQaEvidence.screenshots.length : 0
  const hasSuccessfulEvidence = Boolean(latestQaEvidence?.executed) && screenshots > 0
  if (hasSuccessfulEvidence) return false

  if (latestReason.includes('no frontend dev/start scripts discovered') && changedCount === 0 && branchDiffCount === 0) {
    return false
  }

  return true
}

export function formatQaEvidenceForPrompt(evidence: QaEvidencePayload | null | undefined): string {
  if (!evidence) return 'No QA evidence run.'
  const screenshots = Array.isArray(evidence.screenshots) && evidence.screenshots.length
    ? evidence.screenshots
        .map((item) => {
          const shot = asRecord(item)
          const path = String(shot.path || item || '')
          const url = String(shot.url || '')
          const viewport = String(shot.viewport || '')
          return `- [${viewport || 'capture'}] ${path}${url ? ` (url: ${url})` : ''}`
        })
        .join('\n')
    : '- None'
  const logs = Array.isArray(evidence.logs) && evidence.logs.length
    ? evidence.logs.slice(-10).map((line: string) => `- ${line}`).join('\n')
    : '- None'

  return [
    `Executed: ${Boolean(evidence.executed)}`,
    `Reason: ${String(evidence.reason || 'n/a')}`,
    `Base URL: ${String(evidence.base_url || 'n/a')}`,
    `Script: ${String(evidence.script || 'n/a')}`,
    '',
    'Screenshots:',
    screenshots,
    '',
    'Execution logs (tail):',
    logs,
  ].join('\n')
}

export function parseJsonPlan(raw: string): { commands: string[]; checks: string[]; ops: unknown[] } | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = String(fenced?.[1] || text)
  try {
    const parsed = JSON.parse(candidate) as { commands?: unknown[]; checks?: unknown[]; ops?: unknown[] }
    return {
      commands: Array.isArray(parsed?.commands) ? parsed.commands.map((item) => String(item || '').trim()).filter(Boolean) : [],
      checks: Array.isArray(parsed?.checks) ? parsed.checks.map((item) => String(item || '').trim()).filter(Boolean) : [],
      ops: Array.isArray(parsed?.ops) ? parsed.ops : [],
    }
  } catch {
    return null
  }
}

export function evaluateDeliveryGate(params: {
  task: TaskRecord
  comments: CommentRecord[]
  policy: RuntimePolicy
  classifiers: { frontend: RegExp; documentation: RegExp }
  worktreeArtifacts: {
    changed_files?: string[]
    files_between_branches?: string[]
    recent_commits?: string[]
    exists?: boolean
  } | null
  qaEvidence?: QaEvidencePayload | null
  actionExecution?: {
    quality?: {
      test_commands_run?: number
      test_commands_passed?: number
      install_commands_run?: number
      tests_applicable?: boolean
    }
  }
  getRuntimePolicy: () => RuntimePolicy
}): { pass: boolean; reasons: string[]; shouldEscalate: boolean } {
  const { task, comments, worktreeArtifacts, qaEvidence, actionExecution, policy, classifiers } = params
  const reasons: string[] = []
  const deliveryGatePolicy = policy.delivery_gate
  const handoffPolicy = policy.handoff
  const changedCount = worktreeArtifacts?.changed_files?.length || 0
  const branchDiffCount = worktreeArtifacts?.files_between_branches?.length || 0
  const testsRun = Number(actionExecution?.quality?.test_commands_run || 0)
  const testsPassed = Number(actionExecution?.quality?.test_commands_passed || 0)
  const testsApplicable = actionExecution?.quality?.tests_applicable !== false
  const rejectionCount = countQaRejections(comments)
  const blockedCount = countDeliveryGateBlocks(comments, deliveryGatePolicy.blocked_comment_marker)
  const frontend = isLikelyFrontendTask(task, classifiers.frontend, classifiers.documentation)
  const documentationOnly = isDocumentationOnlyTask(task, classifiers.documentation)

  if (deliveryGatePolicy.require_code_delta && changedCount === 0 && branchDiffCount === 0) {
    reasons.push('No code delta detected (changed files and branch diff are both zero)')
  }
  if (!documentationOnly && deliveryGatePolicy.require_tests_for_non_documentation && testsApplicable) {
    if (testsRun === 0) {
      reasons.push('No automated tests were executed in developer loop')
    } else if (testsPassed === 0) {
      reasons.push('Automated tests executed but none passed successfully')
    }
  }
  if (frontend && deliveryGatePolicy.require_frontend_qa_evidence) {
    const screenshots = Array.isArray(qaEvidence?.screenshots) ? qaEvidence.screenshots.length : 0
    if (!qaEvidence?.executed || screenshots === 0) {
      reasons.push('Frontend QA evidence missing (no successful screenshot capture)')
    }
  }

  return {
    pass: reasons.length === 0,
    reasons,
    shouldEscalate: rejectionCount >= handoffPolicy.max_retry_before_block || blockedCount >= handoffPolicy.max_retry_before_block,
  }
}

export async function buildClosureComment(params: {
  profile: Profile
  policy: RuntimePolicy
  role: 'vicks' | 'wedge'
  task: TaskRecord
  project: ProjectRecord | undefined
  decision: string
  primaryOutput: string
  priorComments: CommentRecord[]
  callLLM: (prompt: string, profile: Profile) => Promise<string>
}): Promise<string> {
  const { profile, policy, role, task, project, decision, primaryOutput, priorComments, callLLM } = params
  const inputBudget = getInputBudget(profile, policy)
  const previous = compactCommentsForPrompt(priorComments, Math.max(3000, Math.floor(inputBudget * 0.28)))
  const compactSystem = compactFreeText(profile.systemPrompt, Math.max(6000, Math.floor(inputBudget * 0.36)))
  const compactPrimaryOutput = compactFreeText(primaryOutput || 'No direct output captured', Math.max(4000, Math.floor(inputBudget * 0.3)))

  const prompt = `${compactSystem}

You are writing the final professional handoff comment for a software task transition.
Role: ${role}
Decision/Transition: ${decision}

Task:
- ID: ${task.id}
- Title: ${task.title}
- Description: ${task.description || 'No description'}
- Project: ${project?.name || task.project_id || 'Unknown'}
- Workspace: ${task.workspace_path || 'Unknown'}
- Branch: ${task.work_branch || 'Unknown'}

Primary output from this agent:
${compactPrimaryOutput}

Recent comments/context:
${previous || 'No prior comments'}

Write a concise but detailed technical report in markdown, with this structure:
1) Summary
2) Work Completed (bullet list)
3) Files/Areas Touched or Reviewed (bullet list, be explicit when known, otherwise say Not explicitly specified)
4) Validation / Review Evidence
5) Handoff Notes / Next Steps

Rules:
- Do not invent facts.
- If something is unknown, state it clearly.
- Use professional tone suitable for audit trail.
- Keep it under 300 words.
- This platform works with worktrees; uncommitted worktree changes are valid evidence.
- Never claim a task is invalid only because there is no git commit.
`

  const generated = await callLLM(compactFreeText(prompt, inputBudget), profile)
  const trimmed = trimToCommentLimit(generated, policy.handoff.max_closure_comment_chars)
  if (!trimmed) {
    throw new Error('LLM returned empty closure comment')
  }
  return trimmed
}

export async function buildExecutionPlanWithLLM(params: {
  profile: Profile
  policy: RuntimePolicy
  task: TaskRecord
  context: TaskRecord
  comments: CommentRecord[]
  workspacePath: string
  callLLM: (prompt: string, profile: Profile) => Promise<string>
}): Promise<{ commands: string[]; checks: string[]; ops: PlanOp[] }> {
  const { profile, policy, task, context, comments, workspacePath, callLLM } = params
  const inputBudget = getInputBudget(profile, policy)
  const compactSystem = compactFreeText(profile.systemPrompt, Math.max(5000, Math.floor(inputBudget * 0.38)))
  const compactRecentComments = compactCommentsForPrompt(comments.slice(-12), Math.max(2500, Math.floor(inputBudget * 0.2)))
  const prompt = `${compactSystem}

Create an executable implementation command plan for this task.

Task:
- id: ${task.id}
- title: ${task.title}
- description: ${task.description || 'No description'}
- workspace: ${workspacePath || 'unknown'}
- worktree branch: ${context.work_branch || 'unknown'}

Recent comments:
${compactRecentComments}

Return strict JSON only:
{
  "ops": [{"tool":"list|read|write|edit|move|delete|glob|search","args":{}}],
  "commands": ["<shell command>", "..."],
  "checks": ["<verification command>"]
}

Rules:
- Max ${policy.planning.max_commands} commands and max ${policy.planning.max_checks} checks
- Commands must be non-interactive and deterministic
- Never include destructive commands
- Never include git commit/push/merge/rebase operations
- Commands must create measurable delivery delta for this task, not only diagnostics
- Prefer commands that are valid from workspace root and include worktree-safe operations
- Prefer structured ops for file listing/reading/searching/editing; use commands for install/build/test only
- Include test creation/update and at least one test execution command
- If test tooling/dependencies are missing, include installation/bootstrap commands before test execution
`

  const planRaw = await callLLM(compactFreeText(prompt, inputBudget), profile)
  const parsed = parseJsonPlan(planRaw)
  if (!parsed) {
    throw new Error('LLM execution plan is invalid JSON or missing required fields')
  }
  const maxCommands = Math.max(1, Number(policy.planning.max_commands || 4))
  const maxChecks = Math.max(0, Number(policy.planning.max_checks || 2))
  return {
    commands: parsed.commands.slice(0, maxCommands),
    checks: parsed.checks.slice(0, maxChecks),
    ops: normalizePlanOps(parsed.ops, policy.planning.max_structured_ops),
  }
}
