import type { MCPClient } from './mcp-client'
import { getRuntimePolicy } from './policy'
import { asRecord, sleep, DEFAULT_POLL_MS } from '@kosmos/shared'
import { logger as makeLogger } from './lib/logger'

const log = makeLogger('kosmos')


function asTaskRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map((item) => asRecord(item))
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.tasks)) return obj.tasks.map((item) => asRecord(item))
    if (Array.isArray(obj.data)) return obj.data.map((item) => asRecord(item))
  }
  return []
}

function asProjectRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map((item) => asRecord(item))
  return []
}

function taskSortTimestamp(task: Record<string, unknown>): number {
  return Date.parse(String(task.updated_at || task.created_at || '')) || 0
}

function isAssignableTask(task: Record<string, unknown>): boolean {
  const status = String(task.status || '').toLowerCase()
  const assignedTo = String(task.assigned_to || '').trim()
  const parentTaskId = String(task.parent_task_id || '').trim()
  const taskKind = String(task.task_kind || 'task').trim()
  return status === 'todo' && !assignedTo && (!parentTaskId || taskKind !== 'subtask')
}

function rankTodoTasks(params: { todoTasks: Record<string, unknown>[]; priorityOrder: string[] }): Record<string, unknown>[] {
  const { todoTasks, priorityOrder } = params
  return [...todoTasks].sort((a, b) => {
    const aPriority = String(a.priority || 'medium').toLowerCase()
    const bPriority = String(b.priority || 'medium').toLowerCase()
    const aIdx = priorityOrder.indexOf(aPriority)
    const bIdx = priorityOrder.indexOf(bPriority)
    const priorityDiff = (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
    if (priorityDiff !== 0) return priorityDiff

    const aRequeue = Number(a.requeue_count || 0)
    const bRequeue = Number(b.requeue_count || 0)
    if (aRequeue !== bRequeue) return aRequeue - bRequeue

    const aUpdated = taskSortTimestamp(a)
    const bUpdated = taskSortTimestamp(b)
    return aUpdated - bUpdated
  })
}

function isEscalatedTaskInCooldown(task: Record<string, unknown>, cooldownMs: number): boolean {
  const lastEscalatedAt = String(task.last_escalated_at || '')
  if (!lastEscalatedAt) return false
  const elapsed = Date.now() - Date.parse(lastEscalatedAt)
  return Number.isFinite(elapsed) && elapsed < cooldownMs
}



interface KosmosProfileState {
  activeTaskId: string | null
  lastRecoveryAt: number
  lastCooldownActivityByTask: Record<string, number>
  cycleInFlight: boolean
}

export async function runKosmosLoop(mcp: MCPClient) {
  const selfPid = process.pid
  const state: KosmosProfileState = {
    activeTaskId: null,
    lastRecoveryAt: 0,
    lastCooldownActivityByTask: {},
    cycleInFlight: false,
  }

  const policy = getRuntimePolicy('kosmos')
  const pollIntervalMs = Math.max(500, Number(policy.orchestration?.poll_interval_ms || DEFAULT_POLL_MS))

  log.info(`Orchestration loop started (poll: ${pollIntervalMs}ms)`)

  while (true) {
    if (state.cycleInFlight) {
      await sleep(pollIntervalMs)
      continue
    }

    state.cycleInFlight = true
    try {
      await mcp.heartbeatAgent(selfPid, 'kosmos loop heartbeat')
      await kosmosCycle(mcp, state)
    } catch (error: unknown) {
      log.error(`Cycle error: ${error}`)
    } finally {
      state.cycleInFlight = false
    }

    await sleep(pollIntervalMs)
  }
}

async function kosmosCycle(mcp: MCPClient, state: KosmosProfileState) {
  const policy = getRuntimePolicy('kosmos')
  const orchestration = policy.orchestration || {}
  const handoff = policy.handoff || {}
  const priorityOrder = Array.isArray(orchestration.priority_order)
    ? orchestration.priority_order.map((item: unknown) => String(item || '').toLowerCase())
    : ['high', 'medium', 'low']
  const maxRequeueBeforePause = Math.max(1, Number(handoff.max_requeue_before_pause || 8))
  const escalatedTaskCooldownMs = Math.max(1000, Number(orchestration.escalated_task_cooldown_ms || 120000))
  const cooldownActivityThrottleMs = Math.max(1000, Number(orchestration.cooldown_activity_throttle_ms || 60000))


  const projectsRaw = await mcp.listProjects()
  const projects = asProjectRecordArray(projectsRaw)
  if (!projects.length) return

  const allProgressRaw = await Promise.all(
    projects.map((project) => mcp.getTasks(String(project.id || ''), 'progress'))
  )
  const allProgress = allProgressRaw.flatMap((tasks) => asTaskRecordArray(tasks))

  if (allProgress.length > 0) {
    const ordered = [...allProgress].sort((a, b) => taskSortTimestamp(a) - taskSortTimestamp(b))
    const activeProgress = ordered[0]

    if (ordered.length > 1) {
      const overflow = ordered.slice(1)
      for (const task of overflow) {
        await mcp.addComment(
          String(task.id || ''),
          'Task re-queued to todo to keep a single active implementation slot and avoid agent thrashing.',
          'kosmos',
        )
        await mcp.moveTask(String(task.id || ''), 'todo', 'kosmos', 'Re-queued to todo (single active slot)')
      }
    }

    if (activeProgress?.id) {
      state.activeTaskId = String(activeProgress.id)
    }
    await monitorActiveTask(mcp, state)
    return
  }

  const recovered = await recoverOrphanedInFlightTasks(mcp, projects, state)
  if (recovered) return

  if (state.activeTaskId) {
    await monitorActiveTask(mcp, state)
    return
  }

  for (const project of projects) {
    if (state.activeTaskId) break

    const todoRaw = await mcp.getTasks(String(project.id || ''), 'todo')
    const todoTasks = asTaskRecordArray(todoRaw)
    const todoUnassigned = todoTasks.filter((task) => isAssignableTask(task))
    const prioritizedTodo = rankTodoTasks({ todoTasks: todoUnassigned, priorityOrder })
    const pausedByLoopGuard = prioritizedTodo.filter((task) => Number(task.requeue_count || 0) >= maxRequeueBeforePause)
    const eligibleTodo = prioritizedTodo.filter((task) => Number(task.requeue_count || 0) < maxRequeueBeforePause)

    for (const task of pausedByLoopGuard) {
      const now = Date.now()
      const lastNotifiedAt = Number(state.lastCooldownActivityByTask[String(task.id || '')] || 0)
      if ((now - lastNotifiedAt) < cooldownActivityThrottleMs) continue

      log.warn(`Loop guard paused task after repeated requeues (${Number(task.requeue_count || 0)}): ${task.title}`)
      state.lastCooldownActivityByTask[String(task.id || '')] = now
    }

    if (!eligibleTodo.length) continue

    const llmSelected = await selectTaskWithLLM(mcp, project, eligibleTodo)
    const cooldownFilteredTodo = eligibleTodo.filter((task) => !isEscalatedTaskInCooldown(task, escalatedTaskCooldownMs))
    const planningPool = cooldownFilteredTodo.length > 0 ? cooldownFilteredTodo : prioritizedTodo
    const selectedTask = planningPool.find((task) => String(task.id) === llmSelected) || planningPool[0]

    if (!selectedTask) continue
    if (!selectedTask.workspace_path) {
      log.warn(`Task ${selectedTask.title} has no workspace_path, skipping`)
      continue
    }

    log.info(`Processing task: ${selectedTask.title}`)
    const taskId = String(selectedTask.id || '')
    const workspacePath = String(selectedTask.workspace_path || '')

    try {
      await mcp.gitInit(workspacePath)
      const branchName = `task/${taskId.slice(0, 8)}`
      await mcp.gitCreateWorktree(workspacePath, branchName, taskId)

      const latestTask = asRecord(await mcp.getTask(taskId))
      const latestStatus = String(latestTask.status || '').toLowerCase()
      if (latestStatus !== 'todo') {
        log.info(`Task no longer TODO (${latestStatus}): ${selectedTask.title}`)
        continue
      }

      await mcp.moveTask(taskId, 'progress', 'vicks', `Delegated to Vicks on branch ${branchName}`)
      log.success(`Delegated task to Vicks: ${selectedTask.title}`)

      const spawnResult = asRecord(await mcp.spawnAgent('vicks'))
      log.info(`Spawned Vicks: ${JSON.stringify(spawnResult)}`)
      state.activeTaskId = taskId
    } catch (error: unknown) {
      log.error(`Error processing task ${taskId}: ${error}`)
      if (typeof error === 'object' && error && 'message' in error) {
        await mcp.addComment(taskId, `Kosmos ERROR: ${String((error as Error).message)}`, 'kosmos')
      }
    }

    if (state.activeTaskId) break
  }
}

async function selectTaskWithLLM(
  _mcp: MCPClient,
  _project: Record<string, unknown>,
  todoTasks: Record<string, unknown>[],
): Promise<string | null> {
  const selected = todoTasks[0]
  return selected ? String(selected.id) : null
}

async function recoverOrphanedInFlightTasks(
  mcp: MCPClient,
  projects: Record<string, unknown>[],
  state: KosmosProfileState,
): Promise<boolean> {
  const policy = getRuntimePolicy('kosmos')
  const orchestration = policy.orchestration || {}
  const recoveryCooldownMs = Math.max(1000, Number(orchestration.recovery_cooldown_ms || 120000))
  const qaStaleMs = Math.max(1000, Number(orchestration.qa_stale_ms || 120000))
  const progressStaleMs = Math.max(1000, Number(orchestration.progress_stale_ms || 180000))
  const now = Date.now()
  const inCooldown = now - state.lastRecoveryAt < recoveryCooldownMs
  if (inCooldown) return false

  const activeAgentsRaw = await mcp.getActiveAgents()
  const activeAgentsList = asTaskRecordArray(activeAgentsRaw)
  const active = activeAgentsList.map((a) => String(a.profile_id || '').toLowerCase())

  for (const project of projects) {
    const qaRaw = await mcp.getTasks(String(project.id || ''), 'qa')
    const qaTasks = asTaskRecordArray(qaRaw)

    for (const task of qaTasks) {
      const updatedAt = Date.parse(String(task.updated_at || ''))
      if (!Number.isFinite(updatedAt)) continue
      if (Date.now() - updatedAt < qaStaleMs) continue
      if (active.includes('wedge')) continue

      const staleMinutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000))
      const taskId = String(task.id || '')
      await mcp.addComment(taskId, [
        `## Kosmos Watchdog Recovery`,
        '',
        'QA task appeared orphaned and was recovered automatically.',
        '',
        `- Status: qa`,
        `- Stale time: ${staleMinutes}m`,
        `- Action: Respawned Wedge`,
      ].join('\n'), 'kosmos')

      const spawnResult = asRecord(await mcp.spawnAgent('wedge'))
      state.lastRecoveryAt = now
      if (!state.activeTaskId) state.activeTaskId = taskId
      log.info(`Recovered orphaned QA task ${taskId}; spawned Wedge PID ${JSON.stringify(spawnResult)}`)
      return true
    }
  }

  for (const project of projects) {
    const progressRaw = await mcp.getTasks(String(project.id || ''), 'progress')
    const progressTasks = asTaskRecordArray(progressRaw)

    for (const task of progressTasks) {
      const updatedAt = Date.parse(String(task.updated_at || ''))
      if (!Number.isFinite(updatedAt)) continue
      if (Date.now() - updatedAt < progressStaleMs) continue
      if (active.includes('vicks')) continue

      const staleMinutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000))
      const taskId = String(task.id || '')
      await mcp.addComment(taskId, [
        `## Kosmos Watchdog Recovery`,
        '',
        'Progress task appeared orphaned and was recovered automatically.',
        '',
        `- Status: progress`,
        `- Stale time: ${staleMinutes}m`,
        `- Action: Respawned Vicks`,
      ].join('\n'), 'kosmos')

      const spawnResult = asRecord(await mcp.spawnAgent('vicks'))
      state.lastRecoveryAt = now
      if (!state.activeTaskId) state.activeTaskId = taskId
      log.info(`Recovered orphaned progress task ${taskId}; spawned Vicks PID ${JSON.stringify(spawnResult)}`)
      return true
    }
  }

  return false
}

async function monitorActiveTask(
  mcp: MCPClient,
  state: KosmosProfileState,
) {
  if (!state.activeTaskId) return

  const policy = getRuntimePolicy('kosmos')
  const orchestration = policy.orchestration || {}

  const task = asRecord(await mcp.getTask(state.activeTaskId))
  if (!task || !task.id) {
    state.activeTaskId = null
    return
  }

  const status = String(task.status || '')
  if (status === 'done' || status === 'todo') {
    log.info(`Clearing active task ${task.id} (status: ${status})`)
    state.activeTaskId = null
    return
  }

  if (status !== 'progress' && status !== 'qa') {
    state.activeTaskId = null
    return
  }

  if (status === 'progress') {
    const progressStaleMs = Math.max(1000, Number(orchestration.progress_stale_ms || 180000))
    const updatedAt = Date.parse(String(task.updated_at || ''))
    if (!Number.isFinite(updatedAt)) return
    if (Date.now() - updatedAt < progressStaleMs) return

    const activeAgentsRaw = await mcp.getActiveAgents()
    const activeAgentsList = asTaskRecordArray(activeAgentsRaw)
    const hasVicks = activeAgentsList.some((a) => String(a.profile_id || '').toLowerCase() === 'vicks')
    if (!hasVicks) {
      const spawnResult = asRecord(await mcp.spawnAgent('vicks'))
      log.info(`Respawned Vicks for stale progress task: ${JSON.stringify(spawnResult)}`)
    }
  }

  if (status === 'qa') {
    const qaStaleMs = Math.max(1000, Number(orchestration.qa_stale_ms || 120000))
    const updatedAt = Date.parse(String(task.updated_at || ''))
    if (!Number.isFinite(updatedAt)) return
    if (Date.now() - updatedAt < qaStaleMs) return

    const activeAgentsRaw = await mcp.getActiveAgents()
    const activeAgentsList = asTaskRecordArray(activeAgentsRaw)
    const hasWedge = activeAgentsList.some((a) => String(a.profile_id || '').toLowerCase() === 'wedge')
    if (!hasWedge) {
      const spawnResult = asRecord(await mcp.spawnAgent('wedge'))
      log.info(`Respawned Wedge for stale QA task: ${JSON.stringify(spawnResult)}`)
    }
  }
}
