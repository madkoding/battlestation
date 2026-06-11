import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { asRecord, sleep } from '@kosmos/shared'
import type { RuntimePolicy } from '@kosmos/shared'
import { MCPClient } from './mcp-client'
import { runKosmosLoop } from './kosmos-loop'
import { getRuntimePolicy } from './policy'
import { formatQaDecisionForPrompt, resolveQaDecision } from './qa-decision'
import type { QaDecision } from './qa-decision'
import {
  asUnknownArray,
  asWorkspaceExecResult,
  asWorktreeArtifacts,
  asQaEvidencePayload,
  asTaskRecordArray,
  asProjectRecordArray,
  asCommentRecordArray,
  taskSortTimestamp,
  getInputBudget,
  compactFreeText,
  compactProjectInstructions,
  extractHeadline,
  countQaRejections,
  collectQaIssueHints,
  isTestCommand,
  isInstallCommand,
  buildTaskClassifiers,
  getLoopSleepMs,
  formatArtifactsForPrompt,
  resolveWorktreePath,
  isLikelyFrontendTask,
  getLatestQaEvidencePayload,
  formatQaScreenshotMarkdown,
  appendCommentSection,
  shouldRunFrontendQaEvidence,
  formatQaEvidenceForPrompt,
  evaluateDeliveryGate,
  buildClosureComment,
  buildExecutionPlanWithLLM,
} from './agent-utils'
import type {
  AgentRecord,
  TaskRecord,
  CommentRecord,
  PlanOp,
  WorktreeArtifacts,
  Profile,
} from './agent-utils'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error || 'operation failed')
      results.push({ label: `${op.tool}`, ok: false, preview: message.slice(0, 220) })
    }
  }

  return results
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
    callLLM,
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

async function main() {
  console.log(`[agent:${PROFILE_ID}] Starting...`)
  console.log(`[agent:${PROFILE_ID}] MCP Server: ${MCP_SERVER_URL}`)

  process.on('SIGTERM', () => {
    console.log(`[agent:${PROFILE_ID}] Received SIGTERM, shutting down...`)
    process.exit(0)
  })

  const mcp = new MCPClient({ serverUrl: MCP_SERVER_URL, agentName: PROFILE_ID })
  const profile = loadProfile(PROFILE_ID)
  await enforceGlobalLlmConfig(mcp, profile)
  console.log(`[agent:${PROFILE_ID}] Model: ${profile.model}`)
  console.log(`[agent:${PROFILE_ID}] System prompt loaded (${profile.systemPrompt.length} chars)`)

  console.log(`[agent:${PROFILE_ID}] Agent ready. Starting autonomous loop...`)
  console.log(`[agent:${PROFILE_ID}] Profile ID: ${PROFILE_ID}`)

  if (PROFILE_ID === 'kosmos') {
    await runKosmosLoop(mcp)
  } else if (PROFILE_ID === 'vicks') {
    await runVicksLoop(mcp, profile)
  } else if (PROFILE_ID === 'wedge') {
    await runWedgeLoop(mcp, profile)
  } else {
    console.error(`[agent:${PROFILE_ID}] Unknown profile. Valid profiles: kosmos, vicks, wedge`)
    process.exit(1)
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
        getRuntimePolicy: () => getRuntimePolicy('vicks'),
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
          callLLM,
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
          callLLM,
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
          callLLM,
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
function isInfraLlmError(message: string): boolean {
  return /401|403|404|unauthorized|forbidden|invalid api key|api key|model.+not found|no such model|provider.+unavailable|rate limit|timeout/i
    .test(String(message || ''))
}

main().catch(console.error)
