import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { compilePolicyRegex } from '@kosmos/shared'
import type { RuntimePolicy } from '@kosmos/shared'
import { MCPClient } from './mcp-client'
import { getRuntimePolicy } from './policy'
import { formatQaDecisionForPrompt, resolveQaDecision } from './qa-decision'
import type { QaDecision } from './qa-decision'

const PROJECT_INSTRUCTIONS_MAX_CHARS = 12000

const __dirname = dirname(fileURLToPath(import.meta.url))

type AgentRecord = Record<string, unknown>
type TaskRecord = Record<string, unknown>
type ProjectRecord = Record<string, unknown>
type CommentRecord = Record<string, unknown>
type PlanOp = { tool: string; args: AgentRecord }

interface QaEvidencePayload {
  executed?: boolean
  reason?: string
  base_url?: string
  script?: string
  screenshots?: Array<{ path?: string; url?: string; viewport?: string }>
  logs?: string[]
}

interface WorktreeArtifacts {
  exists?: boolean
  changed_files?: string[]
  recent_commits?: string[]
  files_between_branches?: string[]
}

interface WorkspaceExecResult {
  ok?: boolean
  stdout?: string
  stderr?: string
}

function asRecord(value: unknown): AgentRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as AgentRecord
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function asWorkspaceExecResult(value: unknown): WorkspaceExecResult {
  const raw = asRecord(value)
  return {
    ok: typeof raw.ok === 'boolean' ? raw.ok : undefined,
    stdout: raw.stdout === undefined ? undefined : String(raw.stdout),
    stderr: raw.stderr === undefined ? undefined : String(raw.stderr),
  }
}

function asWorktreeArtifacts(value: unknown): WorktreeArtifacts | null {
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

function asQaEvidencePayload(value: unknown): QaEvidencePayload | null {
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

function asTaskRecordArray(value: unknown): TaskRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asRecord(item))
}

function asProjectRecordArray(value: unknown): ProjectRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asRecord(item))
}

function asCommentRecordArray(value: unknown): CommentRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asRecord(item))
}

function taskSortTimestamp(task: TaskRecord): number {
  const raw = String(task.updated_at || task.created_at || '')
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseRuntimeOptions(argv: string[]) {
  const options = {
    profileId: 'kosmos',
    mcpServerUrl: 'http://localhost:18792',
  }

  for (const arg of argv) {
    if (arg.startsWith('--profile=')) {
      options.profileId = arg.slice('--profile='.length) || options.profileId
      continue
    }
    if (arg.startsWith('--server-url=')) {
      options.mcpServerUrl = arg.slice('--server-url='.length) || options.mcpServerUrl
      continue
    }
    if (!arg.startsWith('--') && options.profileId === 'kosmos') {
      options.profileId = arg
    }
  }

  return options
}

const runtimeOptions = parseRuntimeOptions(process.argv.slice(2))
const PROFILE_ID = runtimeOptions.profileId
const MCP_SERVER_URL = runtimeOptions.mcpServerUrl

interface Profile {
  model: string
  provider: string
  base_url: string
  api_key: string
  temperature: number
  top_p: number
  max_tokens: number
  systemPrompt: string
}

const DEFAULT_FRONTEND_TASK_REGEX = /\bfrontend\b|\bux\b|\breact\b|\bvite\b|\bnext\b|\btailwind\b|\bcss\b|\bhtml\b|\bcomponent(s)?\b|\blayout\b|\bresponsive\b|\bdashboard\b|\bmodal\b|\bkanban\b|\bscreenshot(s)?\b|\bplaywright\b|\buser interface\b|\bui shell\b|\bnavigation\b/i
const DEFAULT_DOCUMENTATION_TASK_REGEX = /release|deployment|deploy|documentation|docs|runbook|handoff|contribution/i
const DEFAULT_QA_REJECTION_REGEX = /reject|cannot approve|failed|return to development/i
const DEFAULT_QA_HINT_REGEX = /required|next action|blocking|root cause|deliverables|port|playwright|screenshot|diff|changed files|commit/i

function estimateTokenCount(text: string): number {
  const value = String(text || '')
  if (!value) return 0
  return Math.ceil(value.length / 4)
}

function getInputBudget(profile: Profile, policy: RuntimePolicy): number {
  const contextWindowTokens = Number(policy.context.window_tokens || 128000)
  const contextInputBudgetRatio = Number(policy.context.input_budget_ratio || 0.72)
  const reserve = Math.max(2048, Math.min(Number(profile.max_tokens || 8192), 32768))
  const budget = Math.floor(contextWindowTokens * contextInputBudgetRatio) - reserve
  return Math.max(8000, budget)
}

function compactFreeText(text: string, maxTokens: number): string {
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

function compactProjectInstructions(text: string, maxChars = PROJECT_INSTRUCTIONS_MAX_CHARS): string {
  const source = String(text || '').trim()
  if (!source) return ''
  const cap = Math.max(800, Number(maxChars || PROJECT_INSTRUCTIONS_MAX_CHARS))
  if (source.length <= cap) return source

  const head = source.slice(0, Math.floor(cap * 0.72)).trimEnd()
  const tail = source.slice(-Math.floor(cap * 0.2)).trimStart()
  return `${head}\n\n[project instructions compacted]\n\n${tail}`
}

function compactCommentsForPrompt(comments: CommentRecord[], maxTokens: number): string {
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

function loadProfile(profileId: string): Profile {
  const agentSrcDir = join(__dirname, '..')
  const projectRoot = join(agentSrcDir, '..', '..')
  const PROFILE_PATH = join(projectRoot, 'config', 'profiles', profileId)
  const files = ['PROFILE.md', 'SOUL.md', 'WORKFLOW.md', 'STYLE.md', 'GUARDRAILS.md', 'POLICY.md']

  const profileMd = readFileSync(join(PROFILE_PATH, 'PROFILE.md'), 'utf-8')
  const config: Record<string, string> = {}
  const configMatch = profileMd.match(/---\n([\s\S]*?)\n---/)
  if (configMatch) {
    configMatch[1].split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split(':')
      if (key && valueParts.length) {
        config[key.trim()] = valueParts.join(':').trim()
      }
    })
  }

  let systemPrompt = ''
  for (const file of files) {
    const filePath = join(PROFILE_PATH, file)
    try {
      const content = readFileSync(filePath, 'utf-8')
      systemPrompt += `\n\n# ${file.replace('.md', '')}\n${content}`
    } catch {
      // File doesn't exist, skip
    }
  }

  return {
    model: String(config.model || '').trim(),
    provider: String(config.provider || '').trim(),
    base_url: '',
    api_key: '',
    temperature: parseFloat(config.temperature) || 0.2,
    top_p: parseFloat(config.top_p) || 0.9,
    max_tokens: parseInt(config.max_tokens) || 16384,
    systemPrompt,
  }
}

function resolveProviderApiKey(providerConfig: AgentRecord): string {
  return String(providerConfig.api_key || '').trim()
}

async function enforceGlobalLlmConfig(mcp: MCPClient, profile: Profile): Promise<void> {
  try {
    const rawConfig = asRecord(await mcp.getConfig())
    const llm = asRecord(rawConfig.llm)
    const provider = String(llm.default_provider || '').trim()
    const providers = asRecord(llm.providers)
    const providerConfig = asRecord(providers[provider])
    const model = String(providerConfig.model || '').trim()
    const baseUrl = String(providerConfig.base_url || '').trim()
    const apiKey = resolveProviderApiKey(providerConfig)

    if (provider) {
      profile.provider = provider
    }
    if (model) {
      profile.model = model
    }
    if (baseUrl) {
      profile.base_url = baseUrl
    }
    profile.api_key = apiKey
  } catch {
    // keep current profile values when config is temporarily unavailable
  }

  if (!profile.provider || !profile.model) {
    throw new Error('Missing global LLM configuration. Configure provider/model in Settings first.')
  }
}

async function callLLM(prompt: string, profile: Profile): Promise<string> {
  const defaultBaseUrl = profile.provider === 'ollama'
    ? 'http://localhost:11434'
    : 'https://api.openai.com/v1'
  const baseUrl = profile.base_url || defaultBaseUrl
  const resolvedApiKey = profile.api_key || ''
  const isOllamaCloud = profile.provider === 'ollama' && /ollama\.com|\/v1$/i.test(baseUrl)

  const endpoint = (profile.provider === 'ollama' && !isOllamaCloud)
    ? `${baseUrl}/api/generate`
    : `${baseUrl}/chat/completions`

  const body = (profile.provider === 'ollama' && !isOllamaCloud)
    ? {
        model: profile.model,
        prompt,
        stream: false,
        options: {
          temperature: profile.temperature,
          top_p: profile.top_p,
          num_predict: 800,
        },
      }
    : {
        model: profile.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: profile.temperature,
        max_tokens: profile.max_tokens,
      }

  const doRequest = async (payload: Record<string, unknown>) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...((profile.provider !== 'ollama' || isOllamaCloud) ? { 'Authorization': `Bearer ${resolvedApiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  const response = await doRequest(body as Record<string, unknown>)

  if (!response.ok) {
    let details = response.statusText
    try {
      const errData = await response.json() as { error?: string; message?: string }
      details = errData.error || errData.message || details
    } catch {
      // noop
    }
    throw new Error(`LLM error: ${response.status} ${details}`)
  }

  const data = await response.json()
  const text = (profile.provider === 'ollama' && !isOllamaCloud) ? data.response : data.choices?.[0]?.message?.content || ''
  if (profile.provider === 'ollama' && !isOllamaCloud && !String(text || '').trim()) {
    throw new Error(`LLM error: empty response from configured model '${profile.model}'`)
  }
  return text
}

function trimToCommentLimit(text: string, maxChars: number): string {
  const normalized = String(text || '').trim()
  if (!normalized) return ''
  const limit = Math.max(400, Number(maxChars || 3500))
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit)}\n\n[truncated]`
}

function extractHeadline(text: string, fallback: string): string {
  const firstNonEmpty = String(text || '')
    .split('\n')
    .map((line) => line.replace(/^[-#*\s]+/, '').trim())
    .find((line) => line.length > 0)
  return (firstNonEmpty || fallback).slice(0, 180)
}

function countQaRejections(comments: CommentRecord[]): number {
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

function countDeliveryGateBlocks(comments: CommentRecord[], marker: string): number {
  const safeMarker = String(marker || '## Delivery Gate Blocked')
  return comments.filter((c) => {
    const agent = String(c?.agent_name || '').toLowerCase()
    const text = String(c?.comment || '')
    return agent === 'vicks' && text.includes(safeMarker)
  }).length
}

function collectQaIssueHints(comments: CommentRecord[]): string[] {
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

function isTestCommand(command: string): boolean {
  const cmd = String(command || '').toLowerCase()
  return /(^|\s)(npm|pnpm|yarn|bun)\s+run\s+test(\s|$)|(^|\s)(npx\s+)?(vitest|jest|playwright\s+test)(\s|$)|(^|\s)pytest(\s|$)|(^|\s)go\s+test(\s|$)|(^|\s)cargo\s+test(\s|$)|(^|\s)(mvn|gradle)\s+test(\s|$)/.test(cmd)
}

function isInstallCommand(command: string): boolean {
  const cmd = String(command || '').toLowerCase()
  return /(^|\s)(npm|pnpm|yarn|bun)\s+(install|i|add)(\s|$)|(^|\s)npm\s+init\b|(^|\s)pip\s+install(\s|$)|(^|\s)playwright\s+install(\s|$)/.test(cmd)
}

function isDocumentationOnlyTask(task: TaskRecord, documentationPattern: RegExp): boolean {
  const corpus = [
    String(task?.title || ''),
    String(task?.description || ''),
  ].join(' ').toLowerCase()
  return documentationPattern.test(corpus)
}

function normalizePlanOps(rawOps: unknown[], maxOps: number): PlanOp[] {
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

function buildTaskClassifiers(policy: RuntimePolicy): { frontend: RegExp; documentation: RegExp } {
  return {
    frontend: compilePolicyRegex(policy.classification.frontend_task_pattern, DEFAULT_FRONTEND_TASK_REGEX),
    documentation: compilePolicyRegex(policy.classification.documentation_task_pattern, DEFAULT_DOCUMENTATION_TASK_REGEX),
  }
}

function getLoopSleepMs(policy: RuntimePolicy): { idle: number; error: number; escalation: number } {
  const idle = Math.max(250, Number(policy.loop.idle_sleep_ms || 5000))
  const error = Math.max(250, Number(policy.loop.error_sleep_ms || 5000))
  const escalation = Math.max(250, Number(policy.loop.escalation_sleep_ms || 20000))
  return { idle, error, escalation }
}

async function executeStructuredOps(params: {
  mcp: MCPClient
  workspacePath: string
  taskId: string
  ops: PlanOp[]
}): Promise<Array<{ label: string; ok: boolean; preview?: string }>> {
  const { mcp, workspacePath, taskId, ops } = params
  const results: Array<{ label: string; ok: boolean; preview?: string }> = []

  for (const op of ops) {
    await mcp.touchTask(taskId, 'vicks')
    try {
      let res: unknown = null
      switch (op.tool) {
        case 'list':
          res = await mcp.workspaceList(
            workspacePath,
            String(op.args.path || '.'),
            Boolean(op.args.recursive),
            Number(op.args.limit || 200),
          )
          break
        case 'read':
          res = await mcp.workspaceRead(
            workspacePath,
            String(op.args.path || ''),
            Number(op.args.offset || 1),
            Number(op.args.limit || 300),
          )
          break
        case 'write':
          res = await mcp.workspaceWrite(
            workspacePath,
            String(op.args.path || ''),
            String(op.args.content || ''),
            Boolean(op.args.append),
          )
          break
        case 'edit':
          res = await mcp.workspaceEdit(workspacePath, {
            path: String(op.args.path || ''),
            find: String(op.args.find || ''),
            replace: String(op.args.replace || ''),
            all: Boolean(op.args.all),
            regex: Boolean(op.args.regex),
            ignore_case: Boolean(op.args.ignore_case),
          })
          break
        case 'move':
          res = await mcp.workspaceMove(
            workspacePath,
            String(op.args.from || ''),
            String(op.args.to || ''),
          )
          break
        case 'delete':
          res = await mcp.workspaceDelete(
            workspacePath,
            String(op.args.path || ''),
            Boolean(op.args.recursive),
          )
          break
        case 'glob':
          res = await mcp.workspaceGlob(
            workspacePath,
            String(op.args.pattern || '**/*'),
            String(op.args.path || '.'),
            Number(op.args.limit || 200),
          )
          break
        case 'search':
          res = await mcp.workspaceSearch(workspacePath, {
            pattern: String(op.args.pattern || ''),
            path: String(op.args.path || '.'),
            include: op.args.include ? String(op.args.include) : undefined,
            limit: Number(op.args.limit || 200),
            regex: Boolean(op.args.regex),
            ignore_case: Boolean(op.args.ignore_case),
          })
          break
      }
      const resRecord = asRecord(res)
      const ok = Boolean(resRecord.ok !== false)
      const preview = typeof res === 'object' ? JSON.stringify(res).slice(0, 220) : String(res || '').slice(0, 220)
      results.push({ label: `${op.tool}`, ok, preview })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'operation failed')
      results.push({ label: `${op.tool}`, ok: false, preview: message.slice(0, 220) })
    }
  }

  return results
}

function evaluateDeliveryGate(params: {
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

async function buildClosureComment(params: {
  profile: Profile
  policy: RuntimePolicy
  role: 'vicks' | 'wedge'
  task: TaskRecord
  project: ProjectRecord | undefined
  decision: string
  primaryOutput: string
  priorComments: CommentRecord[]
}): Promise<string> {
  const { profile, policy, role, task, project, decision, primaryOutput, priorComments } = params
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

function formatArtifactsForPrompt(artifacts: {
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

function resolveWorktreePath(task: TaskRecord): string {
  const workspace = String(task.workspace_path || '').trim()
  const branch = String(task.work_branch || '').trim()
  if (!workspace) return ''
  if (!branch) return workspace
  return join(workspace, '.worktrees', branch)
}

function isLikelyFrontendTask(task: TaskRecord, frontendPattern: RegExp, documentationPattern: RegExp): boolean {
  const corpus = [
    String(task?.title || ''),
    String(task?.description || ''),
  ].join(' ').toLowerCase()

  const isDeliveryOrDocs = documentationPattern.test(corpus)
  const frontendSignals = frontendPattern.test(corpus)
  if (isDeliveryOrDocs && !frontendSignals) return false
  return frontendSignals
}

function getLatestQaEvidencePayload(entries: unknown[]): QaEvidencePayload | null {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const latest = asRecord(entries[0])
  const payload = asRecord(latest.payload)
  if (Object.keys(payload).length === 0) return null
  return payload as QaEvidencePayload
}

interface QaScreenshotRef {
  evidenceId: string
  index: number
  path: string
  viewport: string
  url: string
  apiUrl: string
}

function collectQaScreenshotRefs(taskId: string, entries: unknown[], maxItems = 4): QaScreenshotRef[] {
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

function formatQaScreenshotMarkdown(taskId: string, entries: unknown[]): string {
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

function appendCommentSection(baseComment: string, sectionMarkdown: string, maxChars: number): string {
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

function shouldRunFrontendQaEvidence(params: {
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

function formatQaEvidenceForPrompt(evidence: QaEvidencePayload | null | undefined): string {
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

function parseJsonPlan(raw: string): { commands: string[]; checks: string[]; ops: unknown[] } | null {
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

async function buildExecutionPlanWithLLM(params: {
  profile: Profile
  policy: RuntimePolicy
  task: TaskRecord
  context: TaskRecord
  comments: CommentRecord[]
  workspacePath: string
}): Promise<{ commands: string[]; checks: string[]; ops: PlanOp[] }> {
  const { profile, policy, task, context, comments, workspacePath } = params
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

async function executeActionPlan(params: {
  mcp: MCPClient
  profile: Profile
  policy: RuntimePolicy
  task: TaskRecord
  context: TaskRecord
  comments: CommentRecord[]
  workspacePath: string
  taskId: string
}): Promise<{
  executed: Array<{ command: string; ok: boolean }>
  logs: string
  hasDelta: boolean
  quality: {
    test_commands_run: number
    test_commands_passed: number
    install_commands_run: number
    tests_applicable: boolean
  }
  artifacts: WorktreeArtifacts | null
}> {
  const { mcp, profile, policy, task, context, comments, workspacePath, taskId } = params
  const resolvedWorktreePath = resolveWorktreePath(context || task)
  const executionPath = resolvedWorktreePath && existsSync(resolvedWorktreePath)
    ? resolvedWorktreePath
    : workspacePath
  const llmPlan = await buildExecutionPlanWithLLM({
    profile,
    policy,
    task,
    context,
    comments,
    workspacePath: executionPath,
  })

  const commandsToRun = llmPlan.commands.length > 0 ? llmPlan.commands : llmPlan.checks
  if (commandsToRun.length === 0) {
    throw new Error('LLM plan did not provide executable commands or checks')
  }

  const safeCommands = commandsToRun
    .filter((cmd) => !/rm\s+-rf|git\s+reset\s+--hard|git\s+checkout\s+--|git\s+commit|git\s+push|git\s+merge|git\s+rebase|git\s+tag|:\(\)|shutdown|reboot|mkfs/i.test(cmd))
    .slice(0, Math.max(1, Number(policy.planning.max_commands || 4)))

  const resolveQualityCommands = async (): Promise<{ install?: string; test?: string; testsApplicable: boolean; hasRealTestScript: boolean }> => {
    const placeholderPattern = String(policy.delivery_gate.placeholder_test_script_pattern || 'no test specified')
    const skipPlaceholderTestScript = policy.delivery_gate.skip_placeholder_test_script !== false
    const probe = asWorkspaceExecResult(await mcp.workspaceExec(
      executionPath,
      `node -e "const fs=require('fs');const path=require('path');const pm=fs.existsSync('pnpm-lock.yaml')?'pnpm':(fs.existsSync('yarn.lock')?'yarn':(fs.existsSync('bun.lockb')?'bun':'npm'));const hasNodeModules=fs.existsSync('node_modules');const hasPkg=fs.existsSync('package.json');let testKey='';let hasRealTestScript=false;if(hasPkg){const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));const scripts=pkg.scripts||{};const keys=Object.keys(scripts);const testScript=String(scripts.test||'');const placeholderRe=new RegExp(${JSON.stringify(placeholderPattern)},'i');hasRealTestScript=Boolean(testScript)&&(${skipPlaceholderTestScript ? '!placeholderRe.test(testScript)' : 'true'});const fallbackTestKey=keys.find(k=>/^test:/.test(k))||'';testKey=hasRealTestScript?'test':fallbackTestKey;}const skipDirs=new Set(['node_modules','.git','.worktrees','dist','build','coverage']);const walk=(dir)=>{if(!fs.existsSync(dir))return 0;let n=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skipDirs.has(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())n+=walk(p);else if(/\\.(ts|tsx|js|jsx)$/.test(e.name))n++;if(n>200)return n;}return n;};const sourceFiles=walk('.');console.log(JSON.stringify({pm,testKey,hasNodeModules,hasPkg,sourceFiles,hasRealTestScript}));"`,
      30000,
    ))
    try {
      const parsed = JSON.parse(String(probe?.stdout || '{}')) as {
        pm?: string
        testKey?: string
        hasNodeModules?: boolean
        hasPkg?: boolean
        sourceFiles?: number
        hasRealTestScript?: boolean
      }
      const pm = String(parsed.pm || 'npm')
      const testKey = String(parsed.testKey || '')
      const hasNodeModules = Boolean(parsed.hasNodeModules)
      const hasPkg = Boolean(parsed.hasPkg)
      const sourceFiles = Number(parsed.sourceFiles || 0)
      const hasRealTestScript = Boolean(parsed.hasRealTestScript)
      const nodeDevDependencies = Array.isArray(policy.runtime_bootstrap.node_dev_dependencies)
        ? policy.runtime_bootstrap.node_dev_dependencies.map((value) => String(value).trim()).filter(Boolean)
        : ['vitest', 'typescript', '@types/node']
      const bootstrapDeps = nodeDevDependencies.length > 0
        ? nodeDevDependencies.join(' ')
        : 'vitest typescript @types/node'
      const defaultTestCommand = `npx ${String(policy.runtime_bootstrap.ensure_scripts.test || 'vitest run').trim()} --passWithNoTests`
      let install: string | undefined
      if (!hasPkg) {
        install = sourceFiles > 0
          ? `npm init -y && npm install -D ${bootstrapDeps}`
          : undefined
      } else {
        install = hasNodeModules
          ? undefined
          : (pm === 'yarn' ? 'yarn install --non-interactive' : `${pm} install`)
      }
      const testsApplicable = hasPkg || sourceFiles > 0
      const test = testKey
        ? (pm === 'yarn' ? `yarn ${testKey}` : `${pm} run ${testKey}`)
        : (sourceFiles > 0 ? defaultTestCommand : undefined)
      return { install, test, testsApplicable, hasRealTestScript }
    } catch {
      return { testsApplicable: true, hasRealTestScript: true }
    }
  }

  let effectiveCommands = safeCommands
  if (effectiveCommands.length === 0) {
    throw new Error('LLM plan produced only blocked or unsafe commands')
  }

  const executed: Array<{ command: string; ok: boolean }> = []
  const logLines: string[] = []
  let testsRun = 0
  let testsPassed = 0
  let installsRun = 0

  const structuredOps = llmPlan.ops || []
  if (structuredOps.length > 0) {
    const opResults = await executeStructuredOps({
      mcp,
      workspacePath: executionPath,
      taskId,
      ops: structuredOps,
    })
    for (const op of opResults) {
      logLines.push(`- op:${op.label} => ${op.ok ? 'ok' : 'fail'}${op.preview ? ` | ${op.preview}` : ''}`)
    }
  }

  const qualityCommands = await resolveQualityCommands()
  if (!qualityCommands.hasRealTestScript && qualityCommands.test) {
    effectiveCommands = effectiveCommands.filter((cmd) => !isTestCommand(cmd))
  }
  if (qualityCommands.install && !effectiveCommands.some((cmd) => isInstallCommand(cmd))) {
    effectiveCommands = [qualityCommands.install, ...effectiveCommands]
  }
  if (qualityCommands.test && !effectiveCommands.some((cmd) => isTestCommand(cmd))) {
    effectiveCommands = [...effectiveCommands, qualityCommands.test]
  }
  effectiveCommands = effectiveCommands.slice(0, Math.max(1, Number(policy.planning.max_effective_commands || 8)))

  for (const command of effectiveCommands) {
    await mcp.touchTask(taskId, 'vicks')
    const result = asWorkspaceExecResult(await mcp.workspaceExec(executionPath, command, 120000))
    executed.push({ command, ok: Boolean(result?.ok) })
    const stderr = String(result?.stderr || '').trim()
    const stdout = String(result?.stdout || '').trim()
    const preview = stderr || stdout
    logLines.push(`- ${command} => ${result?.ok ? 'ok' : 'fail'}${preview ? ` | ${preview.slice(0, 220)}` : ''}`)
    if (isTestCommand(command)) {
      testsRun += 1
      if (result?.ok) testsPassed += 1
    }
    if (isInstallCommand(command)) {
      installsRun += 1
    }
  }

  const worktreePath = resolveWorktreePath(context || task)
  const artifacts = worktreePath
    ? asWorktreeArtifacts(await mcp.gitListWorktreeArtifacts({
        worktreePath,
        repoPath: String(context?.workspace_path || task?.workspace_path || ''),
        baseBranch: String(context?.base_branch || task?.base_branch || ''),
        workBranch: String(context?.work_branch || task?.work_branch || ''),
      }))
    : null

  const hasDelta = (artifacts?.changed_files?.length || 0) > 0
    || (artifacts?.files_between_branches?.length || 0) > 0

  return {
    executed,
    logs: logLines.join('\n'),
    hasDelta,
    quality: {
      test_commands_run: testsRun,
      test_commands_passed: testsPassed,
      install_commands_run: installsRun,
      tests_applicable: qualityCommands.testsApplicable,
    },
    artifacts,
  }
}

async function loadProjectAgentsInstructions(mcp: MCPClient, projectId: string): Promise<string> {
  const safeProjectId = String(projectId || '').trim()
  if (!safeProjectId) return ''
  try {
    const document = asRecord(await mcp.getProjectAgentsMd(safeProjectId))
    const content = String(document.content || '').trim()
    return compactProjectInstructions(content)
  } catch {
    return ''
  }
}

function composeTaskPrompt(params: {
  compactSystem: string
  task: TaskRecord
  context: TaskRecord
  compactComments: string
  compactQaHints: string
  projectInstructions: string
}): string {
  const {
    compactSystem,
    task,
    context,
    compactComments,
    compactQaHints,
    projectInstructions,
  } = params

  const projectSection = projectInstructions
    ? `\n## Project Instructions (AGENTS.md)\n${projectInstructions}\n`
    : ''

  return `${compactSystem}

## Current Task
Title: ${task.title}
Description: ${task.description || 'No description'}

## Context
Workspace: ${context.workspace_path}
Branch: ${context.work_branch}
Base branch: ${context.base_branch}
${projectSection}
## Previous Comments
${compactComments}

## Open QA Issues To Resolve (if any)
${compactQaHints}

## Your Task
Implement the changes needed for this task. When done, move it to QA and add a comment explaining what was done.

Rules:
- Do not create git commits; work is validated directly in the task worktree.
- Create or update tests for new logic and execute them.
- If test tooling is missing, install/bootstrap the minimum required tooling and then run tests.
`
}

async function main() {
  console.log(`[agent:${PROFILE_ID}] Starting...`)
  console.log(`[agent:${PROFILE_ID}] MCP Server: ${MCP_SERVER_URL}`)

  const mcp = new MCPClient({ serverUrl: MCP_SERVER_URL, agentName: PROFILE_ID })
  const profile = loadProfile(PROFILE_ID)
  await enforceGlobalLlmConfig(mcp, profile)
  console.log(`[agent:${PROFILE_ID}] Model: ${profile.model}`)
  console.log(`[agent:${PROFILE_ID}] System prompt loaded (${profile.systemPrompt.length} chars)`)

  console.log(`[agent:${PROFILE_ID}] Agent ready. Starting autonomous loop...`)
  console.log(`[agent:${PROFILE_ID}] Profile ID: ${PROFILE_ID}`)

  if (PROFILE_ID === 'vicks') {
    await runVicksLoop(mcp, profile)
  } else if (PROFILE_ID === 'wedge') {
    await runWedgeLoop(mcp, profile)
  } else {
    console.log(`[agent:${PROFILE_ID}] No specific loop for profile. Waiting...`)
    await new Promise(() => {})
  }
}

async function runVicksLoop(mcp: MCPClient, profile: Profile) {
  console.log(`[agent:${PROFILE_ID}] Vicks developer loop started`)
  const selfPid = process.pid
  const blockedStateByTask = new Map<string, { signature: string; attempts: number; escalated: boolean }>()

  while (true) {
    try {
      await enforceGlobalLlmConfig(mcp, profile)
      const policy = getRuntimePolicy('vicks')
      const classifiers = buildTaskClassifiers(policy)
      const loopSleep = getLoopSleepMs(policy)
      await mcp.heartbeatAgent(selfPid, 'vicks loop heartbeat')
      const projects = asProjectRecordArray(await mcp.listProjects())
      if (!projects.length) {
        await sleep(loopSleep.idle)
        continue
      }

      const tasksByProject = await Promise.all(
        projects.map((project) => mcp.getTasks(String(project.id || ''), 'progress'))
      )
      const myTasks = tasksByProject
        .flatMap((tasks) => asTaskRecordArray(tasks))
        .filter((task) => String(task.assigned_to || '') === 'vicks')
        .sort((a, b) => taskSortTimestamp(a) - taskSortTimestamp(b))

      if (myTasks.length === 0) {
        blockedStateByTask.clear()
        await sleep(loopSleep.idle)
        continue
      }

      const task = myTasks[0]
      console.log(`[agent:${PROFILE_ID}] Working on task: ${task.title}`)
      const taskId = String(task.id || '')
      await mcp.heartbeatAgent(selfPid, `working task ${taskId}`)

      const context = asRecord(await mcp.getTask(taskId))
      const comments = asCommentRecordArray(await mcp.getComments(taskId))
      const blockedMarker = String(policy.delivery_gate.blocked_comment_marker || '## Delivery Gate Blocked')
      const escalationMarker = String(policy.delivery_gate.escalation_comment_marker || '## Delivery Escalation Required')
      const retryThreshold = Math.max(1, Number(policy.handoff.max_retry_before_block || 3))
      const latestVicksBlockedComment = comments
        .slice()
        .reverse()
        .find((comment) => {
          const agent = String(comment?.agent_name || '').toLowerCase()
          const text = String(comment?.comment || '')
          return agent === 'vicks' && text.includes(blockedMarker)
        })
      const latestExternalComment = comments
        .slice()
        .reverse()
        .find((comment) => String(comment?.agent_name || '').toLowerCase() !== 'vicks')
      const latestEscalationComment = comments
        .slice()
        .reverse()
        .find((comment) => {
          const agent = String(comment?.agent_name || '').toLowerCase()
          const text = String(comment?.comment || '')
          return agent === 'vicks' && text.includes(escalationMarker)
        })

      const blockedAt = String(latestVicksBlockedComment?.created_at || '')
      const externalAt = String(latestExternalComment?.created_at || '')
      const escalationAt = String(latestEscalationComment?.created_at || '')
      const hasExternalUpdateSinceBlock = Boolean(blockedAt && externalAt && externalAt > blockedAt)
      const escalationAlreadyRaisedForBlock = Boolean(blockedAt && escalationAt && escalationAt >= blockedAt)

      if (latestVicksBlockedComment && !hasExternalUpdateSinceBlock) {
        const previousBlockedState = blockedStateByTask.get(taskId)
        const passiveAttempts = (previousBlockedState?.attempts || 0) + 1
        let escalated = Boolean(previousBlockedState?.escalated) || escalationAlreadyRaisedForBlock

        if (!escalated && passiveAttempts >= retryThreshold) {
          await mcp.addComment(taskId, [
            escalationMarker,
            '',
            'Task is still blocked with no external updates since the latest delivery-gate failure.',
            '',
            `- blocked_attempts_same_signature: ${passiveAttempts}`,
            `- retry_threshold: ${retryThreshold}`,
            '',
            '### Recommendation',
            '- Re-plan task sequencing based on prerequisites and unblock implementation foundations first.',
            '- Keep this task in progress until prerequisites are fulfilled or reassignment is performed.',
          ].join('\n'), 'vicks')
          escalated = true
        }

        blockedStateByTask.set(taskId, {
          signature: 'passive-blocked',
          attempts: passiveAttempts,
          escalated,
        })

        await sleep(loopSleep.escalation)
        continue
      }

      blockedStateByTask.delete(taskId)

      await mcp.touchTask(taskId, 'vicks')

      const qaIssueHints = collectQaIssueHints(comments)
      const inputBudget = getInputBudget(profile, policy)
      const compactSystem = compactFreeText(profile.systemPrompt, Math.max(5000, Math.floor(inputBudget * 0.34)))
      const compactComments = compactCommentsForPrompt(comments, Math.max(3000, Math.floor(inputBudget * 0.32)))
      const projectInstructions = await loadProjectAgentsInstructions(mcp, String(task.project_id || ''))
      const compactQaHints = compactFreeText(
        qaIssueHints.length ? qaIssueHints.map((hint) => `- ${hint}`).join('\n') : '- None explicitly listed',
        Math.max(1200, Math.floor(inputBudget * 0.1)),
      )

      void composeTaskPrompt({
        compactSystem,
        task,
        context,
        compactComments,
        compactQaHints,
        projectInstructions,
      })

      const actionExecution = await executeActionPlan({
        mcp,
        profile,
        policy,
        task,
        context,
        comments,
        workspacePath: String(context.workspace_path || ''),
        taskId,
      })

      const worktreeArtifacts = actionExecution.artifacts
      const requiresFrontendEvidence = isLikelyFrontendTask(task, classifiers.frontend, classifiers.documentation)
      const qaEvidenceEntries = requiresFrontendEvidence
        ? asUnknownArray(await mcp.getQaEvidence(taskId))
        : []
      const latestQaEvidence = getLatestQaEvidencePayload(qaEvidenceEntries)
      const qaEvidence = shouldRunFrontendQaEvidence({
        policy,
        requiresFrontendEvidence,
        worktreeArtifacts,
        latestQaEvidence,
      })
        ? asQaEvidencePayload(await mcp.runFrontendQaEvidence(
            existsSync(resolveWorktreePath(context))
              ? resolveWorktreePath(context)
              : String(context.workspace_path || ''),
            taskId,
          ))
        : latestQaEvidence
      const refreshedQaEvidenceEntries = requiresFrontendEvidence
        ? asUnknownArray(await mcp.getQaEvidence(taskId))
        : []
      const qaScreenshotsMarkdown = formatQaScreenshotMarkdown(taskId, refreshedQaEvidenceEntries)

      const gate = evaluateDeliveryGate({
        task,
        comments,
        policy,
        classifiers,
        worktreeArtifacts,
        qaEvidence,
        actionExecution,
      })

      if (!gate.pass) {
      const blockingSignature = gate.reasons.join(' | ')
      const previousBlockedState = blockedStateByTask.get(taskId)
      const sameBlockingSignature = previousBlockedState?.signature === blockingSignature
      const blockedAttempts = sameBlockingSignature ? (previousBlockedState?.attempts || 0) + 1 : 1
      const shouldEscalateByAttempts = blockedAttempts >= retryThreshold
      const shouldEscalate = gate.shouldEscalate || shouldEscalateByAttempts

      const blockerComment = [
          blockedMarker,
          '',
          'Task is not ready for QA transition. Additional implementation evidence is required before handoff.',
          '',
          '### Blocking Reasons',
          ...gate.reasons.map((reason) => `- ${reason}`),
          '',
          '### Delivery Delta',
          `- has_delta: ${actionExecution.hasDelta}`,
          '',
          '### Open QA Issues Considered',
          ...(qaIssueHints.length ? qaIssueHints.map((hint) => `- ${hint}`) : ['- None explicitly listed']),
          '',
          '### Action Execution',
          actionExecution.logs || '- No executable commands detected from plan',
          '',
          '### Quality Execution',
          `- test_commands_run: ${actionExecution.quality.test_commands_run}`,
          `- test_commands_passed: ${actionExecution.quality.test_commands_passed}`,
          `- install_commands_run: ${actionExecution.quality.install_commands_run}`,
          '',
          `### Escalation State\n- qa_rejections_detected: ${countQaRejections(comments)}\n- blocked_attempts_same_signature: ${blockedAttempts}\n- escalation_recommended: ${shouldEscalate}`,
          '',
          '### Next Action',
          shouldEscalate
            ? 'Escalate to human review because repeated cycles show no measurable delivery delta.'
            : 'Continue implementation and retry after code/evidence delta is present.',
        ].join('\n')

        const latestVicksComment = comments
          .slice()
          .reverse()
          .find((comment) => String(comment?.agent_name || '').toLowerCase() === 'vicks')
        const latestVicksText = String(latestVicksComment?.comment || '')
        const shouldSkipBlockerComment = latestVicksText.includes(blockedMarker)
          && gate.reasons.every((reason) => latestVicksText.includes(reason))

        if (!shouldSkipBlockerComment) {
          await mcp.addComment(taskId, blockerComment, 'vicks')
        }
        const alreadyEscalatedForSignature = sameBlockingSignature && Boolean(previousBlockedState?.escalated)
        let escalatedThisRound = false
        if (shouldEscalate && !alreadyEscalatedForSignature && !String(latestVicksComment?.comment || '').includes(escalationMarker)) {
          await mcp.addComment(taskId, [
            escalationMarker,
            '',
            'Repeated blocked cycles were detected without measurable delivery progress.',
            '',
            `- blocked_attempts_same_signature: ${blockedAttempts}`,
            `- retry_threshold: ${retryThreshold}`,
            '',
            '### Recommendation',
            '- Re-plan task sequencing based on prerequisites and unblock implementation foundations first.',
            '- Keep this task in progress until prerequisites are fulfilled or reassignment is performed.',
          ].join('\n'), 'vicks')
          escalatedThisRound = true
        }

        blockedStateByTask.set(taskId, {
          signature: blockingSignature,
          attempts: blockedAttempts,
          escalated: alreadyEscalatedForSignature || escalatedThisRound,
        })

        await sleep(shouldEscalate ? loopSleep.escalation : loopSleep.idle)
        continue
      }

      blockedStateByTask.delete(taskId)
        const closureComment = await buildClosureComment({
          profile,
          policy,
          role: 'vicks',
          task,
          project: projects.find((project) => String(project.id || '') === String(task.project_id || '')),
          decision: 'Move task from progress to qa',
          primaryOutput: `## Action Execution\n${actionExecution.logs || '- No executable commands detected from plan'}\n\n## Repository Evidence\n${formatArtifactsForPrompt(worktreeArtifacts)}\n\n## Frontend QA Evidence\n${formatQaEvidenceForPrompt(qaEvidence)}\n\n${qaScreenshotsMarkdown || ''}`,
          priorComments: comments,
        })

      const vicksComment = appendCommentSection(
        closureComment,
        qaScreenshotsMarkdown,
        policy.handoff.max_closure_comment_chars,
      )

      await mcp.addComment(taskId, vicksComment, 'vicks')
      await mcp.moveTask(taskId, 'qa', 'vicks', `Handoff to QA: ${extractHeadline(closureComment, 'Implementation ready for QA')}`)

      console.log(`[agent:${PROFILE_ID}] Task moved to QA: ${task.id}`)

      await mcp.spawnAgent('wedge')
      console.log(`[agent:${PROFILE_ID}] Spawned Wedge for QA`)

      break
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error')
      console.error(`[agent:${PROFILE_ID}] Error:`, message)
      const policy = getRuntimePolicy('vicks')
      const loopSleep = getLoopSleepMs(policy)
      await sleep(loopSleep.error)
    }
  }
}

async function runWedgeLoop(mcp: MCPClient, profile: Profile) {
  console.log(`[agent:${PROFILE_ID}] Wedge QA loop started`)
  const selfPid = process.pid
  let authErrorStreak = 0
  let authBlockedUntil = 0
  const authNotifiedTasks = new Set<string>()
  let lastReviewedTaskId = ''

  while (true) {
    try {
      await enforceGlobalLlmConfig(mcp, profile)
      const policy = getRuntimePolicy('wedge')
      const classifiers = buildTaskClassifiers(policy)
      const loopSleep = getLoopSleepMs(policy)
      if (authBlockedUntil > Date.now()) {
        const remainingMs = authBlockedUntil - Date.now()
        await mcp.heartbeatAgent(selfPid, `qa paused: auth cooldown ${Math.ceil(remainingMs / 1000)}s`)
        await sleep(Math.min(remainingMs, loopSleep.escalation))
        continue
      }
      await mcp.heartbeatAgent(selfPid, 'wedge loop heartbeat')
      const projects = asProjectRecordArray(await mcp.listProjects())
      if (!projects.length) {
        await sleep(loopSleep.idle)
        continue
      }

      const tasksByProject = await Promise.all(
        projects.map((project) => mcp.getTasks(String(project.id || ''), 'qa'))
      )
      const tasks = tasksByProject
        .flatMap((taskList) => asTaskRecordArray(taskList))
        .sort((a, b) => taskSortTimestamp(a) - taskSortTimestamp(b))

      if (tasks.length === 0) {
        await sleep(loopSleep.idle)
        continue
      }

      const task = tasks[0]
      console.log(`[agent:${PROFILE_ID}] Reviewing task: ${task.title}`)
      const taskId = String(task.id || '')
      lastReviewedTaskId = taskId
      await mcp.heartbeatAgent(selfPid, `reviewing task ${taskId}`)
      await mcp.touchTask(taskId, 'wedge')

      const context = asRecord(await mcp.getTask(taskId))
      const comments = asCommentRecordArray(await mcp.getComments(taskId))
      const worktreePath = resolveWorktreePath(context)
      const worktreeArtifacts = worktreePath
        ? asWorktreeArtifacts(await mcp.gitListWorktreeArtifacts({
            worktreePath,
            repoPath: String(context.workspace_path || ''),
            baseBranch: String(context.base_branch || ''),
            workBranch: String(context.work_branch || ''),
          }))
        : null
      const requiresFrontendEvidence = isLikelyFrontendTask(task, classifiers.frontend, classifiers.documentation)
      const qaEvidenceEntries = requiresFrontendEvidence
        ? asUnknownArray(await mcp.getQaEvidence(taskId))
        : []
      const latestQaEvidence = getLatestQaEvidencePayload(qaEvidenceEntries)
      const qaEvidence = shouldRunFrontendQaEvidence({
        policy,
        requiresFrontendEvidence,
        worktreeArtifacts,
        latestQaEvidence,
      })
        ? asQaEvidencePayload(await mcp.runFrontendQaEvidence(
            existsSync(resolveWorktreePath(context))
              ? resolveWorktreePath(context)
              : String(context.workspace_path || ''),
            taskId,
          ))
        : latestQaEvidence
      const refreshedQaEvidenceEntries = requiresFrontendEvidence
        ? asUnknownArray(await mcp.getQaEvidence(taskId))
        : []
      const qaScreenshotsMarkdown = formatQaScreenshotMarkdown(taskId, refreshedQaEvidenceEntries)

      const inputBudget = getInputBudget(profile, policy)
      const compactSystem = compactFreeText(profile.systemPrompt, Math.max(5000, Math.floor(inputBudget * 0.34)))
      const implementationNotes = comments
        .filter((comment) => String(comment.agent_name || '') === 'vicks')
        .map((comment) => String(comment.comment || ''))
        .join('\n')
      const compactImplementationNotes = compactFreeText(implementationNotes, Math.max(3000, Math.floor(inputBudget * 0.35)))
      const projectInstructions = await loadProjectAgentsInstructions(mcp, String(task.project_id || ''))
      const compactQaEvidence = compactFreeText(
        requiresFrontendEvidence
          ? formatQaEvidenceForPrompt(qaEvidence)
          : 'Task does not appear frontend-oriented; screenshot evidence step skipped.',
        Math.max(2500, Math.floor(inputBudget * 0.22)),
      )

      const projectInstructionsSection = projectInstructions
        ? `\n## Project Instructions (AGENTS.md)\n${projectInstructions}\n`
        : ''

      const prompt = `${compactSystem}

## Task to Review
Title: ${task.title}
Description: ${task.description || 'No description'}
${projectInstructionsSection}

## Implementation Notes
${compactImplementationNotes}

## QA Evidence
${compactQaEvidence}

## Your Task
Validate implementation quality, user flows, and visual behavior using the available evidence.

Rules:
- Frontend tasks require flow and visual checks; if screenshots/evidence are weak or missing, reject.
- If tests are missing/failed in implementation notes, reject and request correction.
- Approval requires concrete evidence references, not generic statements.
- Do not require git commits as an approval condition; evaluate worktree evidence, tests, and QA artifacts.
- Return strict JSON only with this schema:
  {
    "decision": "approve|reject",
    "summary": "string",
    "blockers": ["string"],
    "evidence_refs": ["string"],
    "confidence": 0.0
  }
`

      const response = await callLLM(compactFreeText(prompt, inputBudget), profile)
      console.log(`[agent:${PROFILE_ID}] LLM response: ${response.substring(0, 100)}...`)
      const qaDecision: QaDecision = await resolveQaDecision({
        policyAgent: String(policy.agent || 'wedge'),
        inputBudget,
        rawResponse: response,
        compactText: compactFreeText,
        callLLM: (repairPrompt) => callLLM(repairPrompt, profile),
      })
      const shouldApprove = qaDecision.decision === 'approve'
      authErrorStreak = 0
      authBlockedUntil = 0

      if (shouldApprove) {
        const closureComment = await buildClosureComment({
          profile,
          policy,
          role: 'wedge',
          task,
          project: projects.find((project) => String(project.id || '') === String(task.project_id || '')),
          decision: 'Approve QA and move task to done',
          primaryOutput: `${formatQaDecisionForPrompt(qaDecision)}\n\n## Repository Evidence\n${formatArtifactsForPrompt(worktreeArtifacts)}\n\n## Frontend QA Evidence\n${formatQaEvidenceForPrompt(qaEvidence)}\n\n${qaScreenshotsMarkdown || ''}`,
          priorComments: comments,
        })

        const wedgeComment = appendCommentSection(
          closureComment,
          qaScreenshotsMarkdown,
          policy.handoff.max_closure_comment_chars,
        )

        await mcp.addComment(taskId, wedgeComment, 'wedge')
        await mcp.moveTask(taskId, 'done', 'wedge', `QA approved: ${extractHeadline(closureComment, 'QA checks passed')}`)
        console.log(`[agent:${PROFILE_ID}] Task approved and moved to done: ${task.id}`)
      } else {
        const closureComment = await buildClosureComment({
          profile,
          policy,
          role: 'wedge',
          task,
          project: projects.find((project) => String(project.id || '') === String(task.project_id || '')),
          decision: 'Reject QA and return task to progress',
          primaryOutput: `${formatQaDecisionForPrompt(qaDecision)}\n\n## Repository Evidence\n${formatArtifactsForPrompt(worktreeArtifacts)}\n\n## Frontend QA Evidence\n${formatQaEvidenceForPrompt(qaEvidence)}\n\n${qaScreenshotsMarkdown || ''}`,
          priorComments: comments,
        })

        const wedgeComment = appendCommentSection(
          closureComment,
          qaScreenshotsMarkdown,
          policy.handoff.max_closure_comment_chars,
        )

        await mcp.addComment(taskId, wedgeComment, 'wedge')
        await mcp.rejectTask(taskId, extractHeadline(closureComment, qaDecision.summary.slice(0, 180)))
        console.log(`[agent:${PROFILE_ID}] Task rejected: ${task.id}`)

        await mcp.spawnAgent('vicks')
        console.log(`[agent:${PROFILE_ID}] Respawned Vicks after QA rejection`)
      }

      break
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error')
      console.error(`[agent:${PROFILE_ID}] Error:`, message)
      const policy = getRuntimePolicy('wedge')
      const loopSleep = getLoopSleepMs(policy)
      const isInfraError = isInfraLlmError(message)
      if (isInfraError) {
        authErrorStreak += 1
        const initialBackoffMs = Math.max(1000, Number(policy.qa.auth_error_initial_backoff_ms || 120000))
        const maxBackoffMs = Math.max(initialBackoffMs, Number(policy.qa.auth_error_max_backoff_ms || 600000))
        const backoffMs = Math.max(loopSleep.escalation, Math.min(maxBackoffMs, initialBackoffMs * authErrorStreak))
        authBlockedUntil = Date.now() + backoffMs
        try {
          if (lastReviewedTaskId && !authNotifiedTasks.has(lastReviewedTaskId)) {
            await mcp.addComment(lastReviewedTaskId, [
              String(policy.qa.auth_error_pause_comment_marker || '## QA Paused (Infra)'),
              '',
              'QA review is temporarily paused because the QA LLM provider returned an infrastructure/configuration error.',
              '',
              `- retry_backoff_seconds: ${Math.ceil(backoffMs / 1000)}`,
              '- action_required: verify configured API key, provider availability, and model name for wedge profile',
            ].join('\n'), 'wedge')
            authNotifiedTasks.add(lastReviewedTaskId)
          }
        } catch {
          // keep auth backoff even if notification fails
        }
        await mcp.heartbeatAgent(selfPid, `qa blocked: llm auth error (${authErrorStreak})`)
        await sleep(backoffMs)
        continue
      }
      authErrorStreak = 0
      await sleep(loopSleep.error)
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isInfraLlmError(message: string): boolean {
  return /401|403|404|unauthorized|forbidden|invalid api key|api key|model.+not found|no such model|provider.+unavailable|rate limit|timeout/i
    .test(String(message || ''))
}

main().catch(console.error)
