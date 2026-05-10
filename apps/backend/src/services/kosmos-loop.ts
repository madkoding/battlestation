import { getDb, saveDb } from '../db/sqlite-client'
import { compilePolicyRegex } from '@kosmos/shared'
import { spawnAgent, getActiveAgents } from './agent-spawner'
import { getTasks, moveTask, addComment, getTask, getComments, listProjects, touchTaskActivity } from './kanban'
import { gitInit, gitCreateWorktree } from './git'
import { broadcast } from '../ws-server'
import { planNextTaskWithKosmosLLM, buildKosmosRefinementBrief } from './kosmos-llm'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { runWorkspaceCommand } from './workspace-exec'
import { getRuntimePolicy } from './policy'
import type { RuntimePolicy } from '@kosmos/shared'

type TaskRecord = {
  id: string
  project_id: string
  title?: string
  description?: string
  status?: string
  assigned_to?: string
  priority?: string
  workspace_path?: string
  work_branch?: string
  base_branch?: string
  created_at?: string
  updated_at?: string
  last_requeued_at?: string
  escalation_count?: number
  requeue_count?: number
  name?: string
  path?: string
  [key: string]: unknown
}

type TaskCommentRecord = {
  id?: string
  task_id?: string
  agent_id?: string
  agent_name?: string
  comment?: string
  created_at?: string
  [key: string]: unknown
}

const DEFAULT_FRONTEND_LIKE_TASK_REGEX = /frontend|ux|react|vite|next|tailwind|css|html|component|layout|responsive|ui|navigation|dashboard|modal|kanban/i

interface KosmosPolicyContext {
  policy: RuntimePolicy
  frontendPattern: RegExp
  deliveryEscalationMarker: string
}

interface RuntimeBootstrapPolicy {
  nodeDevDependencies: string[]
  frontendExtraDevDependencies: string[]
  ensureScriptDefaults: {
    test: string
    typecheck: string
    frontend_dev: string
  }
  playwrightInstallCommand: string
}

function getKosmosPolicyContext(): KosmosPolicyContext {
  const policy = getRuntimePolicy('kosmos')
  return {
    policy,
    frontendPattern: compilePolicyRegex(policy.classification.frontend_task_pattern, DEFAULT_FRONTEND_LIKE_TASK_REGEX),
    deliveryEscalationMarker: String(policy.delivery_gate.escalation_comment_marker || '## Delivery Escalation Required'),
  }
}

function getRuntimeBootstrapPolicy(policy: RuntimePolicy): RuntimeBootstrapPolicy {
  const runtimeBootstrap = policy.runtime_bootstrap
  const fallbackNodeDeps = ['vitest', 'typescript', '@types/node', '@playwright/test']
  const fallbackFrontendDeps = ['vite']
  const nodeDevDependencies = Array.isArray(runtimeBootstrap.node_dev_dependencies)
    ? runtimeBootstrap.node_dev_dependencies.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const frontendExtraDevDependencies = Array.isArray(runtimeBootstrap.frontend_extra_dev_dependencies)
    ? runtimeBootstrap.frontend_extra_dev_dependencies.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  return {
    nodeDevDependencies: nodeDevDependencies.length > 0 ? nodeDevDependencies : fallbackNodeDeps,
    frontendExtraDevDependencies: frontendExtraDevDependencies.length > 0 ? frontendExtraDevDependencies : fallbackFrontendDeps,
    ensureScriptDefaults: {
      test: String(runtimeBootstrap.ensure_scripts.test || 'vitest run'),
      typecheck: String(runtimeBootstrap.ensure_scripts.typecheck || 'tsc --noEmit'),
      frontend_dev: String(runtimeBootstrap.ensure_scripts.frontend_dev || 'vite --host 127.0.0.1 --port 5173'),
    },
    playwrightInstallCommand: String(runtimeBootstrap.playwright_install_command || 'npx playwright install chromium'),
  }
}

function isFrontendLikeTask(task: TaskRecord, frontendPattern: RegExp): boolean {
  const corpus = [
    String(task?.title || ''),
    String(task?.description || ''),
  ].join(' ').toLowerCase()
  return frontendPattern.test(corpus)
}

function hasSourceFiles(worktreePath: string, extensions: RegExp): boolean {
  const candidates = [worktreePath, join(worktreePath, 'src'), join(worktreePath, 'apps')]
  const roots = candidates.filter((path, index) => candidates.indexOf(path) === index && existsSync(path))
  if (!roots.length) return false
  try {
    const stack = roots.slice(0, 6)
    while (stack.length) {
      const dir = stack.pop() as string
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
          stack.push(full)
          continue
        }
        if (!entry.isFile()) continue
        if (extensions.test(entry.name)) {
          return true
        }
      }
    }
  } catch {
    return false
  }
  return false
}

function detectRuntimeProfile(task: TaskRecord, worktreePath: string, frontendPattern: RegExp): 'node' | 'python' | 'go' | 'unknown' {
  if (existsSync(join(worktreePath, 'package.json'))
    || existsSync(join(worktreePath, 'pnpm-lock.yaml'))
    || existsSync(join(worktreePath, 'yarn.lock'))
    || existsSync(join(worktreePath, 'bun.lockb'))
    || hasSourceFiles(worktreePath, /\.(ts|tsx|js|jsx)$/)) {
    return 'node'
  }

  if (existsSync(join(worktreePath, 'pyproject.toml'))
    || existsSync(join(worktreePath, 'requirements.txt'))
    || existsSync(join(worktreePath, 'requirements-dev.txt'))
    || hasSourceFiles(worktreePath, /\.py$/)) {
    return 'python'
  }

  if (existsSync(join(worktreePath, 'go.mod'))
    || hasSourceFiles(worktreePath, /\.go$/)) {
    return 'go'
  }

  return isFrontendLikeTask(task, frontendPattern) ? 'node' : 'unknown'
}

async function bootstrapTaskRuntime(params: {
  task: TaskRecord
  worktreePath: string
  frontendPattern: RegExp
  nodeDevDependencies: string[]
  frontendExtraDevDependencies: string[]
  ensureScriptDefaults: {
    test: string
    typecheck: string
    frontend_dev: string
  }
  playwrightInstallCommand: string
}): Promise<{ ok: boolean; runtime: string; summary: string; details: string[] }> {
  const {
    task,
    worktreePath,
    frontendPattern,
    nodeDevDependencies,
    frontendExtraDevDependencies,
    ensureScriptDefaults,
    playwrightInstallCommand,
  } = params
  if (!worktreePath || !existsSync(worktreePath)) {
    return { ok: false, runtime: 'unknown', summary: 'Worktree path is missing', details: [] }
  }

  const runtime = detectRuntimeProfile(task, worktreePath, frontendPattern)
  const details: string[] = []

  if (runtime === 'unknown') {
    return { ok: true, runtime, summary: 'No runtime bootstrap required for detected stack', details }
  }

  if (runtime === 'python') {
    const hasVenv = existsSync(join(worktreePath, '.venv'))
    if (!hasVenv) {
      const venv = await runWorkspaceCommand({
        workspacePath: worktreePath,
        command: 'python3 -m venv .venv',
        timeoutMs: 120000,
      })
      if (!venv.ok) {
        return { ok: false, runtime, summary: 'Failed creating python virtual environment', details: [String(venv.stderr || venv.stdout || '').slice(0, 220)] }
      }
      details.push('Created Python virtual environment (.venv)')
    }

    if (existsSync(join(worktreePath, 'requirements.txt'))) {
      const installReq = await runWorkspaceCommand({
        workspacePath: worktreePath,
        command: '. .venv/bin/activate && pip install -r requirements.txt',
        timeoutMs: 240000,
      })
      if (!installReq.ok) {
        return { ok: false, runtime, summary: 'Failed installing requirements.txt', details: [String(installReq.stderr || installReq.stdout || '').slice(0, 220)] }
      }
      details.push('Installed Python requirements from requirements.txt')
    }

    if (existsSync(join(worktreePath, 'pyproject.toml'))) {
      const installProject = await runWorkspaceCommand({
        workspacePath: worktreePath,
        command: '. .venv/bin/activate && pip install -e .',
        timeoutMs: 240000,
      })
      if (installProject.ok) {
        details.push('Installed Python project in editable mode (pip install -e .)')
      }
    }

    const ensurePytest = await runWorkspaceCommand({
      workspacePath: worktreePath,
      command: '. .venv/bin/activate && pip install pytest',
      timeoutMs: 240000,
    })
    if (!ensurePytest.ok) {
      return { ok: false, runtime, summary: 'Failed installing pytest in runtime bootstrap', details: [String(ensurePytest.stderr || ensurePytest.stdout || '').slice(0, 220)] }
    }
    details.push('Ensured pytest is available for developer and QA validation')

    return {
      ok: true,
      runtime,
      summary: 'Runtime bootstrap complete (python environment ready for dev/qa)',
      details,
    }
  }

  if (runtime === 'go') {
    if (!existsSync(join(worktreePath, 'go.mod'))) {
      const moduleName = String(worktreePath.split('/').filter(Boolean).pop() || 'workspace').replace(/[^a-zA-Z0-9._-]/g, '-')
      const modInit = await runWorkspaceCommand({
        workspacePath: worktreePath,
        command: `go mod init ${moduleName}`,
        timeoutMs: 120000,
      })
      if (!modInit.ok) {
        return { ok: false, runtime, summary: 'Failed initializing go.mod', details: [String(modInit.stderr || modInit.stdout || '').slice(0, 220)] }
      }
      details.push(`Initialized Go module (${moduleName})`)
    }

    const tidy = await runWorkspaceCommand({
      workspacePath: worktreePath,
      command: 'go mod tidy',
      timeoutMs: 240000,
    })
    if (!tidy.ok) {
      return { ok: false, runtime, summary: 'Failed running go mod tidy', details: [String(tidy.stderr || tidy.stdout || '').slice(0, 220)] }
    }
    details.push('Prepared Go module dependencies (go mod tidy)')

    return {
      ok: true,
      runtime,
      summary: 'Runtime bootstrap complete (go environment ready for dev/qa)',
      details,
    }
  }

  const packageJsonPath = join(worktreePath, 'package.json')
  if (!existsSync(packageJsonPath)) {
    const initResult = await runWorkspaceCommand({
      workspacePath: worktreePath,
      command: 'npm init -y',
      timeoutMs: 120000,
    })
    if (!initResult.ok) {
      return {
        ok: false,
        runtime,
        summary: 'Failed creating package.json with npm init',
        details: [String(initResult.stderr || initResult.stdout || '').slice(0, 220)],
      }
    }
    details.push('Initialized package.json (npm init -y)')
  }

  const probe = await runWorkspaceCommand({
    workspacePath: worktreePath,
    command: `node -e "const fs=require('fs');const required=JSON.parse(${JSON.stringify(JSON.stringify(nodeDevDependencies))});const frontendExtra=JSON.parse(${JSON.stringify(JSON.stringify(frontendExtraDevDependencies))});const p='package.json';const out={hasPkg:fs.existsSync(p),hasNodeModules:fs.existsSync('node_modules'),hasDev:false,missing:[]};if(out.hasPkg){const pkg=JSON.parse(fs.readFileSync(p,'utf8'));const deps={...(pkg.dependencies||{}),...(pkg.devDependencies||{})};const scripts=pkg.scripts||{};out.hasDev=Boolean(scripts.dev||scripts.start||scripts.preview);for(const dep of required){if(dep && !deps[dep])out.missing.push(dep);}const searchable=((pkg.name||'')+' '+(pkg.description||'')).toLowerCase();if(/frontend|react|vite|ui|layout|responsive/.test(searchable)){for(const dep of frontendExtra){if(dep && !deps[dep])out.missing.push(dep);}}}console.log(JSON.stringify(out));"`,
    timeoutMs: 120000,
  })

  let missingDeps: string[] = []
  let hasNodeModules = false
  let hasDevScript = false
  try {
    const parsed = JSON.parse(String(probe.stdout || '{}')) as { missing?: string[]; hasNodeModules?: boolean; hasDev?: boolean }
    missingDeps = Array.isArray(parsed.missing) ? parsed.missing.map((value) => String(value)).filter(Boolean) : []
    hasNodeModules = Boolean(parsed.hasNodeModules)
    hasDevScript = Boolean(parsed.hasDev)
  } catch {
    missingDeps = [...nodeDevDependencies]
  }

  if (!hasNodeModules) {
    const installAll = await runWorkspaceCommand({
      workspacePath: worktreePath,
      command: 'npm install',
      timeoutMs: 240000,
    })
    if (!installAll.ok) {
      return {
        ok: false,
        runtime,
        summary: 'Failed installing dependencies (npm install)',
        details: [String(installAll.stderr || installAll.stdout || '').slice(0, 220)],
      }
    }
    details.push('Installed dependencies (npm install)')
  }

  const requiredDevDeps = Array.from(new Set([
    ...missingDeps,
    ...(isFrontendLikeTask(task, frontendPattern) ? frontendExtraDevDependencies : []),
  ]))

  if (requiredDevDeps.length > 0) {
    const installDev = await runWorkspaceCommand({
      workspacePath: worktreePath,
      command: `npm install -D ${requiredDevDeps.join(' ')}`,
      timeoutMs: 240000,
    })
    if (!installDev.ok) {
      return {
        ok: false,
        runtime,
        summary: 'Failed installing bootstrap dev dependencies',
        details: [String(installDev.stderr || installDev.stdout || '').slice(0, 220)],
      }
    }
    details.push(`Installed dev dependencies: ${requiredDevDeps.join(', ')}`)
  }

  const ensureScriptsResult = await runWorkspaceCommand({
    workspacePath: worktreePath,
    command: `node -e "const fs=require('fs');const p='package.json';const pkg=JSON.parse(fs.readFileSync(p,'utf8'));pkg.scripts=pkg.scripts||{};if(!pkg.scripts.test)pkg.scripts.test=${JSON.stringify(String(ensureScriptDefaults.test || 'vitest run'))};if(!pkg.scripts.typecheck)pkg.scripts.typecheck=${JSON.stringify(String(ensureScriptDefaults.typecheck || 'tsc --noEmit'))};if(${isFrontendLikeTask(task, frontendPattern) ? 'true' : 'false'} && !pkg.scripts.dev)pkg.scripts.dev=${JSON.stringify(String(ensureScriptDefaults.frontend_dev || 'vite --host 127.0.0.1 --port 5173'))};fs.writeFileSync(p,JSON.stringify(pkg,null,2)+'\\n');"`,
    timeoutMs: 120000,
  })
  if (ensureScriptsResult.ok) {
    details.push('Ensured baseline scripts (test/typecheck/dev when frontend)')
  }

  if (isFrontendLikeTask(task, frontendPattern)) {
    const playwrightInstall = await runWorkspaceCommand({
      workspacePath: worktreePath,
      command: playwrightInstallCommand,
      timeoutMs: 300000,
    })
    if (playwrightInstall.ok) {
      details.push('Prepared Playwright Chromium runtime for QA evidence')
    }
  }

  const summary = hasDevScript
    ? 'Runtime bootstrap complete (existing workspace repaired)'
    : 'Runtime bootstrap complete (workspace initialized for dev/qa)'

  return { ok: true, runtime, summary, details }
}

function priorityWeight(priority: string, priorityOrder: string[]): number {
  const value = String(priority || '').toLowerCase()
  const order = priorityOrder.map((item) => String(item || '').toLowerCase())
  const index = order.indexOf(value)
  if (index >= 0) return index
  const mediumIndex = order.indexOf('medium')
  return mediumIndex >= 0 ? mediumIndex : 1
}

function rankTodoTasks(params: {
  todoTasks: TaskRecord[]
  priorityOrder: string[]
}): TaskRecord[] {
  const { todoTasks, priorityOrder } = params

  return todoTasks
    .slice()
    .sort((a, b) => {
      const aPriority = priorityWeight(String(a.priority || 'medium'), priorityOrder)
      const bPriority = priorityWeight(String(b.priority || 'medium'), priorityOrder)
      if (aPriority !== bPriority) return aPriority - bPriority
      return Date.parse(String(a.created_at || 0)) - Date.parse(String(b.created_at || 0))
    })
}

function hasRecentCommentFromAgent(comments: TaskCommentRecord[], agentName: string, marker: string): boolean {
  const latest = comments
    .slice()
    .reverse()
    .find((comment) => String(comment?.agent_name || '').toLowerCase() === agentName.toLowerCase())
  if (!latest) return false
  return String(latest.comment || '').includes(marker)
}

function isEscalatedTaskInCooldown(task: TaskRecord, cooldownMs: number): boolean {
  const escalations = Number(task.escalation_count || 0)
  if (escalations <= 0) return false
  const lastRequeuedAt = Date.parse(String(task.last_requeued_at || ''))
  if (!Number.isFinite(lastRequeuedAt)) return false
  return (Date.now() - lastRequeuedAt) < cooldownMs
}

function getEscalatedTaskCooldownRemainingMs(task: TaskRecord, cooldownMs: number): number {
  const escalations = Number(task.escalation_count || 0)
  if (escalations <= 0) return 0
  const lastRequeuedAt = Date.parse(String(task.last_requeued_at || ''))
  if (!Number.isFinite(lastRequeuedAt)) return 0
  const elapsed = Date.now() - lastRequeuedAt
  return Math.max(0, cooldownMs - elapsed)
}

function isAssignableTask(task: TaskRecord): boolean {
  const status = String(task.status || '').toLowerCase()
  const assignee = String(task.assigned_to || '').trim()
  return status === 'todo' && assignee.length === 0
}

async function clearStaleTodoAssignments(projects: TaskRecord[]) {
  for (const project of projects) {
    const todoTasks = await getTasks(project.id, 'todo')
    for (const task of todoTasks) {
      if (!String(task.assigned_to || '').trim()) continue
      await touchTaskActivity(task.id, undefined, true)
    }
  }
}

async function bumpTaskRequeueMetrics(taskId: string) {
  const db = await getDb()
  const timestamp = new Date().toISOString()
  db.run(`UPDATE tasks
    SET requeue_count = COALESCE(requeue_count, 0) + 1,
        last_requeued_at = '${timestamp}',
        updated_at = '${timestamp}'
    WHERE id = '${taskId}'`)
  saveDb(db)
}

async function ensureKosmosRefinement(task: TaskRecord, project: TaskRecord) {
  const comments = await getComments(String(task.id || ''))
  const alreadyRefined = comments.some((comment) => {
    const agent = String(comment?.agent_name || '').toLowerCase()
    const text = String(comment?.comment || '')
    return agent === 'kosmos' && text.includes('## Kosmos Task Refinement')
  })
  if (alreadyRefined) return

  const refinementBrief = await buildKosmosRefinementBrief({ task, project })
  await addComment(task.id, `## Kosmos Task Refinement\n\n${refinementBrief}`, 'kosmos')
}

function formatKosmosReport(params: {
  title: string
  summary: string
  details: Array<[string, string]>
  nextStep: string
}) {
  const { title, summary, details, nextStep } = params
  const detailRows = details
    .filter(([, value]) => String(value || '').trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n')

  return [
    `## ${title}`,
    '',
    summary,
    '',
    '### Details',
    detailRows || '- Not available',
    '',
    '### Next Step',
    nextStep,
  ].join('\n')
}

interface KosmosState {
  running: boolean
  intervalId: NodeJS.Timeout | null
  activeTaskId: string | null
  lastRecoveryAt: number
  lastCooldownActivityByTask: Record<string, number>
  cycleInFlight: boolean
}

const state: KosmosState = {
  running: false,
  intervalId: null,
  activeTaskId: null,
  lastRecoveryAt: 0,
  lastCooldownActivityByTask: {},
  cycleInFlight: false,
}

export async function startKosmosLoop() {
  if (state.running) return
  state.running = true

  console.log('[kosmos] Starting autonomous loop...')
  const policyContext = getKosmosPolicyContext()
  const pollIntervalMs = Math.max(500, Number(policyContext.policy.orchestration.poll_interval_ms || 5000))

  state.intervalId = setInterval(async () => {
    if (state.cycleInFlight) return
    state.cycleInFlight = true
    try {
      await kosmosCycle()
    } catch (error) {
      console.error('[kosmos] Cycle error:', error)
    } finally {
      state.cycleInFlight = false
    }
  }, pollIntervalMs)
}

export function stopKosmosLoop() {
  if (state.intervalId) {
    clearInterval(state.intervalId)
    state.intervalId = null
  }
  state.running = false
  console.log('[kosmos] Stopped autonomous loop')
}

async function kosmosCycle() {
  const policyContext = getKosmosPolicyContext()
  const orchestration = policyContext.policy.orchestration
  const runtimeBootstrapPolicy = getRuntimeBootstrapPolicy(policyContext.policy)
  const priorityOrder = Array.isArray(orchestration.priority_order)
    ? orchestration.priority_order.map((item) => String(item || '').toLowerCase())
    : ['high', 'medium', 'low']
  const maxRequeueBeforePause = Math.max(1, Number(policyContext.policy.handoff.max_requeue_before_pause || 8))
  const escalatedTaskCooldownMs = Math.max(1000, Number(orchestration.escalated_task_cooldown_ms || 120000))
  const cooldownActivityThrottleMs = Math.max(1000, Number(orchestration.cooldown_activity_throttle_ms || 60000))

  const projects = await listProjects()
  await clearStaleTodoAssignments(projects)
  if (!projects.length) {
    return
  }

  const allProgress = (await Promise.all(
    projects.map((project) => getTasks(project.id, 'progress'))
  )).flat()

  if (allProgress.length > 0) {
    const ordered = allProgress
      .slice()
      .sort((a, b) => Date.parse(String(a.updated_at || a.created_at || 0)) - Date.parse(String(b.updated_at || b.created_at || 0)))
    const activeProgress = ordered[0]

    if (ordered.length > 1) {
      const overflow = ordered.slice(1)
      for (const task of overflow) {
        await moveTask(
          task.id,
          'todo',
          'kosmos',
          'Task re-queued to todo to keep a single active implementation slot and avoid agent thrashing.'
        )
        await bumpTaskRequeueMetrics(task.id)
      }
    }

    if (activeProgress?.id) {
      state.activeTaskId = activeProgress.id
      const project = projects.find((item) => String(item.id) === String(activeProgress.project_id))
      if (project) {
        await ensureKosmosRefinement(activeProgress, project)
      }
    }
    await monitorActiveTask(policyContext)
    return
  }

  const recovered = await recoverOrphanedInFlightTasks(projects)
  if (recovered) {
    return
  }

  if (state.activeTaskId) {
    await monitorActiveTask(policyContext)
    return
  }

  for (const project of projects) {
    if (state.activeTaskId) break

    const [todoTasks, progressTasks, qaTasks, doneTasks] = await Promise.all([
      getTasks(project.id, 'todo'),
      getTasks(project.id, 'progress'),
      getTasks(project.id, 'qa'),
      getTasks(project.id, 'done'),
    ])
    const todoUnassigned = todoTasks.filter((task) => isAssignableTask(task))
    const prioritizedTodo = rankTodoTasks({
      todoTasks: todoUnassigned,
      priorityOrder,
    })
    const pausedByLoopGuard = prioritizedTodo.filter((task) => Number(task.requeue_count || 0) >= maxRequeueBeforePause)
    const eligibleTodo = prioritizedTodo.filter((task) => Number(task.requeue_count || 0) < maxRequeueBeforePause)

    for (const task of pausedByLoopGuard) {
      const now = Date.now()
      const lastNotifiedAt = Number(state.lastCooldownActivityByTask[task.id] || 0)
      if ((now - lastNotifiedAt) < cooldownActivityThrottleMs) continue

      const comments = await getComments(String(task.id || ''))
      const alreadyPaused = hasRecentCommentFromAgent(comments, 'kosmos', '## Kosmos Loop Guard Pause')
      if (!alreadyPaused) {
        await addComment(task.id, formatKosmosReport({
          title: 'Kosmos Loop Guard Pause',
          summary: 'Task is temporarily paused to prevent repeated LLM/requeue loops without new delivery signal.',
          details: [
            ['Task', `${task.title} (${task.id})`],
            ['Status', String(task.status || 'todo')],
            ['Requeues', `${Number(task.requeue_count || 0)}`],
            ['Escalations', `${Number(task.escalation_count || 0)}`],
            ['Pause threshold', `${maxRequeueBeforePause}`],
          ],
          nextStep: 'Review latest QA blockers and update task scope or prerequisites before re-running Vicks/Wedge.',
        }), 'kosmos')
      }

      broadcast({
        type: 'activity',
        payload: {
          type: 'planning',
          agent: 'kosmos',
          message: `Loop guard paused task after repeated requeues (${Number(task.requeue_count || 0)}): ${task.title}`,
          task_id: task.id,
          project_id: project.id,
          timestamp: new Date().toISOString(),
        },
      })
      state.lastCooldownActivityByTask[task.id] = now
    }

    if (!eligibleTodo.length) {
      continue
    }

    const llmPlan = await planNextTaskWithKosmosLLM({
      project,
      todoTasks: eligibleTodo,
      progressTasks,
      qaTasks,
      doneTasks,
    })

    const cooldownFilteredTodo = eligibleTodo.filter((task) => !isEscalatedTaskInCooldown(task, escalatedTaskCooldownMs))
    const cooldownSkipped = eligibleTodo.filter((task) => isEscalatedTaskInCooldown(task, escalatedTaskCooldownMs))
    const now = Date.now()
    for (const task of cooldownSkipped) {
      const lastNotifiedAt = Number(state.lastCooldownActivityByTask[task.id] || 0)
      if ((now - lastNotifiedAt) < cooldownActivityThrottleMs) continue
      const remainingMs = getEscalatedTaskCooldownRemainingMs(task, escalatedTaskCooldownMs)
      const remainingSeconds = Math.ceil(remainingMs / 1000)
      broadcast({
        type: 'activity',
        payload: {
          type: 'planning',
          agent: 'kosmos',
          message: `Skipped escalated task due cooldown (${remainingSeconds}s remaining): ${task.title}`,
          task_id: task.id,
          project_id: project.id,
          timestamp: new Date().toISOString(),
        },
      })
      state.lastCooldownActivityByTask[task.id] = now
    }
    const planningPool = cooldownFilteredTodo.length > 0 ? cooldownFilteredTodo : prioritizedTodo
    const selectedTask = planningPool.find((task) => task.id === llmPlan.selectedTaskId) || planningPool[0]
    const executionQueue = selectedTask
      ? [selectedTask, ...planningPool.filter((task) => task.id !== selectedTask.id)]
      : planningPool

    for (const task of executionQueue) {
      if (state.activeTaskId) break
      if (!task.workspace_path) continue

      console.log(`[kosmos] Processing task: ${task.title}`)

      try {
        const gitResult = gitInit(task.workspace_path)
        const branchName = `task/${task.id.slice(0, 8)}`
        const worktreeResult = gitCreateWorktree(task.workspace_path, branchName, task.id)
        const bootstrap = await bootstrapTaskRuntime({
          task,
          worktreePath: String(worktreeResult.worktree_path || ''),
          frontendPattern: policyContext.frontendPattern,
          nodeDevDependencies: runtimeBootstrapPolicy.nodeDevDependencies,
          frontendExtraDevDependencies: runtimeBootstrapPolicy.frontendExtraDevDependencies,
          ensureScriptDefaults: runtimeBootstrapPolicy.ensureScriptDefaults,
          playwrightInstallCommand: runtimeBootstrapPolicy.playwrightInstallCommand,
        })

        if (!bootstrap.ok) {
          await addComment(task.id, formatKosmosReport({
            title: 'Kosmos Runtime Bootstrap Blocked',
            summary: 'Task could not be delegated because runtime initialization failed.',
            details: [
              ['Task', `${task.title} (${task.id})`],
              ['Worktree path', String(worktreeResult.worktree_path || '')],
              ['Runtime profile', bootstrap.runtime],
              ['Bootstrap status', bootstrap.summary],
              ['Bootstrap details', bootstrap.details.join(' | ') || 'Not available'],
            ],
            nextStep: 'Fix workspace bootstrap issue so developer and QA can execute the task lifecycle.',
          }), 'kosmos')
          broadcast({
            type: 'activity',
            payload: {
              type: 'planning',
              agent: 'kosmos',
              message: `Runtime bootstrap blocked (${bootstrap.runtime}): ${task.title}`,
              task_id: task.id,
              project_id: project.id,
              timestamp: new Date().toISOString(),
            },
          })
          continue
        }

        broadcast({
          type: 'activity',
          payload: {
            type: 'planning',
            agent: 'kosmos',
            message: `Runtime bootstrap ready (${bootstrap.runtime}): ${bootstrap.details.join('; ') || bootstrap.summary}`,
            task_id: task.id,
            project_id: project.id,
            timestamp: new Date().toISOString(),
          },
        })

        const delegationComment = formatKosmosReport({
          title: 'Kosmos Delegation Report',
          summary: 'Task was prepared for implementation and delegated to the developer agent.',
          details: [
            ['Task', `${task.title} (${task.id})`],
            ['Project', String(project.name || project.id || '')],
            ['Workspace', String(task.workspace_path || '')],
            ['Base branch', String(gitResult.base_branch || '')],
            ['Work branch', branchName],
            ['Worktree path', String(worktreeResult.worktree_path || '')],
            ['Runtime profile', bootstrap.runtime],
            ['Runtime bootstrap', bootstrap.summary],
            ['Runtime inventory', bootstrap.details.join(' | ') || 'No additional actions required'],
            ['Planning rationale', String(llmPlan.rationale || '')],
          ],
          nextStep: 'Vicks implements the requested changes and submits a QA handoff comment.',
        })

        await addComment(task.id, delegationComment, 'kosmos')
        await ensureKosmosRefinement(task, project)

        const latestTask = await getTask(task.id)
        const latestStatus = String(latestTask?.status || '').toLowerCase()
        if (latestStatus !== 'todo') {
          broadcast({
            type: 'activity',
            payload: {
              type: 'planning',
              agent: 'kosmos',
              message: `Skipped delegation because task is no longer TODO (status: ${latestStatus || 'unknown'}): ${task.title}`,
              task_id: task.id,
              project_id: project.id,
              timestamp: new Date().toISOString(),
            },
          })
          continue
        }

        await moveTask(task.id, 'progress', 'vicks', `Delegated to Vicks on branch ${branchName}`)

        broadcast({
          type: 'activity',
          payload: {
            type: 'delegating',
            agent: 'kosmos',
            message: `Delegated task to Vicks: ${task.title}`,
            task_id: task.id,
            project_id: project.id,
            timestamp: new Date().toISOString(),
          },
        })

        const vicks = await spawnAgent('vicks')
        console.log(`[kosmos] Spawned Vicks with PID: ${vicks.pid}`)

        state.activeTaskId = task.id
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[kosmos] Error processing task ${task.id}:`, message)
        await addComment(task.id, `Kosmos ERROR: ${message}`, 'kosmos')
      }
    }

    if (state.activeTaskId) break
  }
}

async function recoverOrphanedInFlightTasks(projects: TaskRecord[]): Promise<boolean> {
  const policyContext = getKosmosPolicyContext()
  const orchestration = policyContext.policy.orchestration
  const recoveryCooldownMs = Math.max(1000, Number(orchestration.recovery_cooldown_ms || 120000))
  const qaStaleMs = Math.max(1000, Number(orchestration.qa_stale_ms || 120000))
  const progressStaleMs = Math.max(1000, Number(orchestration.progress_stale_ms || 180000))
  const now = Date.now()
  const inCooldown = now - state.lastRecoveryAt < recoveryCooldownMs
  if (inCooldown) return false

  const active = getActiveAgents().map((a) => a.profile_id)

  for (const project of projects) {
    const qa = await getTasks(project.id, 'qa')

    for (const task of qa) {
      const updatedAt = Date.parse(String(task.updated_at || ''))
      if (!Number.isFinite(updatedAt)) continue
      if (Date.now() - updatedAt < qaStaleMs) continue
      if (active.includes('wedge')) continue

      const staleMinutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000))
      await addComment(task.id, formatKosmosReport({
        title: 'Kosmos Watchdog Recovery',
        summary: 'QA task appeared orphaned and was recovered automatically.',
        details: [
          ['Task', `${task.title} (${task.id})`],
          ['Status', 'qa'],
          ['Stale time', `${staleMinutes}m`],
          ['Action', 'Respawned Wedge'],
        ],
        nextStep: 'Wedge resumes QA review and closes with approval or rejection details.',
      }), 'kosmos')
      const wedge = await spawnAgent('wedge')
      state.lastRecoveryAt = now
      if (!state.activeTaskId) {
        state.activeTaskId = task.id
      }
      console.log(`[kosmos] Recovered orphaned QA task ${task.id}; spawned Wedge PID ${wedge.pid}`)
      broadcast({
        type: 'activity',
        payload: {
          type: 'watchdog',
          agent: 'kosmos',
          message: `Recovered orphaned QA task: ${task.title}`,
          task_id: task.id,
          project_id: task.project_id,
          timestamp: new Date().toISOString(),
        },
      })
      return true
    }
  }

  for (const project of projects) {
    const progress = await getTasks(project.id, 'progress')

    for (const task of progress) {
      const updatedAt = Date.parse(String(task.updated_at || ''))
      if (!Number.isFinite(updatedAt)) continue
      if (Date.now() - updatedAt < progressStaleMs) continue
      if (active.includes('vicks')) continue

      const staleMinutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000))
      await addComment(task.id, formatKosmosReport({
        title: 'Kosmos Watchdog Recovery',
        summary: 'Progress task appeared orphaned and was recovered automatically.',
        details: [
          ['Task', `${task.title} (${task.id})`],
          ['Status', 'progress'],
          ['Stale time', `${staleMinutes}m`],
          ['Action', 'Respawned Vicks'],
        ],
        nextStep: 'Vicks resumes implementation and posts a structured QA handoff report.',
      }), 'kosmos')
      const vicks = await spawnAgent('vicks')
      state.lastRecoveryAt = now
      if (!state.activeTaskId) {
        state.activeTaskId = task.id
      }
      console.log(`[kosmos] Recovered orphaned progress task ${task.id}; spawned Vicks PID ${vicks.pid}`)
      broadcast({
        type: 'activity',
        payload: {
          type: 'watchdog',
          agent: 'kosmos',
          message: `Recovered orphaned progress task: ${task.title}`,
          task_id: task.id,
          project_id: task.project_id,
          timestamp: new Date().toISOString(),
        },
      })
      return true
    }
  }

  return false
}

async function monitorActiveTask(policyContext: KosmosPolicyContext = getKosmosPolicyContext()) {
  if (!state.activeTaskId) return
  const orchestration = policyContext.policy.orchestration
  const recoveryCooldownMs = Math.max(1000, Number(orchestration.recovery_cooldown_ms || 120000))
  const progressStaleMs = Math.max(1000, Number(orchestration.progress_stale_ms || 180000))
  const qaStaleMs = Math.max(1000, Number(orchestration.qa_stale_ms || 120000))
  const deliveryEscalationMarker = policyContext.deliveryEscalationMarker

  const task = await getTask(state.activeTaskId)
  if (!task) {
    state.activeTaskId = null
    return
  }

  const status = String(task.status || '')
  if (status === 'done' || status === 'todo') {
    console.log(`[kosmos] Clearing active task ${task.id} (status: ${status})`)
    state.activeTaskId = null
    return
  }

  if (status !== 'progress' && status !== 'qa') {
    state.activeTaskId = null
    return
  }

  if (status === 'progress') {
    const comments = await getComments(task.id)
    const latestEscalation = comments
      .slice()
      .reverse()
      .find((c) => {
        const agent = String(c?.agent_name || '').toLowerCase()
        const text = String(c?.comment || '')
        return agent === 'vicks' && text.includes(deliveryEscalationMarker)
      })

    const latestEscalationAt = Date.parse(String(latestEscalation?.created_at || ''))
    const taskLastRequeuedAt = Date.parse(String(task.last_requeued_at || ''))
    const escalationAlreadyHandled = Number.isFinite(latestEscalationAt)
      && Number.isFinite(taskLastRequeuedAt)
      && taskLastRequeuedAt >= latestEscalationAt

    if (latestEscalation && !escalationAlreadyHandled) {
      const latestKosmosReplan = comments
        .slice()
        .reverse()
        .find((c) => {
          const agent = String(c?.agent_name || '').toLowerCase()
          const text = String(c?.comment || '')
          return agent === 'kosmos' && text.includes('## Kosmos Replan Triggered')
        })

      if (!latestKosmosReplan || String(latestKosmosReplan.created_at || '') < String(latestEscalation.created_at || '')) {
        await addComment(task.id, formatKosmosReport({
          title: 'Kosmos Replan Triggered',
          summary: 'Task was escalated by Vicks. Orchestrator will continue with other backlog items while this task awaits prerequisite progress.',
          details: [
            ['Task', `${task.title} (${task.id})`],
            ['Status', 'progress'],
            ['Reason', 'Delivery escalation signal detected from developer loop'],
          ],
          nextStep: 'Backlog planning resumes with prerequisite-first ordering; this task can be resumed after foundations are in place.',
        }), 'kosmos')
      }

      if (String(task.assigned_to || '').trim().toLowerCase() === 'vicks') {
        const alreadyRequeued = hasRecentCommentFromAgent(comments, 'kosmos', 'Task was re-queued to todo')
        if (!alreadyRequeued) {
          await moveTask(
            task.id,
            'todo',
            'kosmos',
            'Task was re-queued to todo after repeated delivery escalation. Prerequisite-first planning resumed.'
          )
          const refreshed = await getTask(task.id)
          if (refreshed && String(refreshed.status || '').toLowerCase() === 'todo') {
            await touchTaskActivity(task.id)
          }
          await bumpTaskRequeueMetrics(task.id)
        }
      }

      state.activeTaskId = null
      return
    }
  }

  const updatedAt = Date.parse(String(task.updated_at || ''))
  if (!Number.isFinite(updatedAt)) return
  const now = Date.now()
  const staleMs = now - updatedAt
  const inCooldown = now - state.lastRecoveryAt < recoveryCooldownMs

  const active = getActiveAgents().map((a) => a.profile_id)

  if (status === 'progress' && !active.includes('vicks')) {
    if (!inCooldown) {
      const vicks = await spawnAgent('vicks')
      state.lastRecoveryAt = now
      console.log(`[kosmos] Ensured Vicks is running (PID: ${vicks.pid}) for active task ${task.id}`)
    }
    return
  }

  if (status === 'qa' && !active.includes('wedge')) {
    if (!inCooldown) {
      const wedge = await spawnAgent('wedge')
      state.lastRecoveryAt = now
      console.log(`[kosmos] Ensured Wedge is running (PID: ${wedge.pid}) for active task ${task.id}`)
    }
    return
  }

  if (inCooldown) return

  if (status === 'progress' && staleMs > progressStaleMs) {
    if (!active.includes('vicks')) {
      const staleMinutes = Math.max(1, Math.round(staleMs / 60000))
      await addComment(task.id, formatKosmosReport({
        title: 'Kosmos Watchdog Recovery',
        summary: 'Active task in progress looked stalled and required recovery.',
        details: [
          ['Task', `${task.title} (${task.id})`],
          ['Status', 'progress'],
          ['Stale time', `${staleMinutes}m`],
          ['Action', 'Respawned Vicks'],
        ],
        nextStep: 'Vicks continues implementation and documents the delivered changes.',
      }), 'kosmos')
      const vicks = await spawnAgent('vicks')
      state.lastRecoveryAt = now
      console.log(`[kosmos] Watchdog respawned Vicks (PID: ${vicks.pid}) for task ${task.id}`)
      broadcast({
        type: 'activity',
        payload: {
          type: 'watchdog',
          agent: 'kosmos',
          message: `Watchdog respawned Vicks for stalled task: ${task.title}`,
          task_id: task.id,
          project_id: task.project_id,
          timestamp: new Date().toISOString(),
        },
      })
    }
    return
  }

  if (status === 'qa' && staleMs > qaStaleMs) {
    if (!active.includes('wedge')) {
      const staleMinutes = Math.max(1, Math.round(staleMs / 60000))
      await addComment(task.id, formatKosmosReport({
        title: 'Kosmos Watchdog Recovery',
        summary: 'Active task in QA looked stalled and required reviewer recovery.',
        details: [
          ['Task', `${task.title} (${task.id})`],
          ['Status', 'qa'],
          ['Stale time', `${staleMinutes}m`],
          ['Action', 'Respawned Wedge'],
        ],
        nextStep: 'Wedge continues QA review and closes with approval/rejection evidence.',
      }), 'kosmos')
      const wedge = await spawnAgent('wedge')
      state.lastRecoveryAt = now
      console.log(`[kosmos] Watchdog respawned Wedge (PID: ${wedge.pid}) for task ${task.id}`)
      broadcast({
        type: 'activity',
        payload: {
          type: 'watchdog',
          agent: 'kosmos',
          message: `Watchdog respawned Wedge for stalled QA task: ${task.title}`,
          task_id: task.id,
          project_id: task.project_id,
          timestamp: new Date().toISOString(),
        },
      })
    }
    return
  }
}

export function clearActiveTask() {
  state.activeTaskId = null
}
