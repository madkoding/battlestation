import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { getDb, saveDb } from '../db/sqlite-client'
import { getConfig } from './config'
import { DEFAULT_PORT } from '@kosmos/shared'

const activeAgents = new Map<number, { profileId: string; child: ChildProcess; startedAt: string }>()

function isProcessActive(child: ChildProcess): boolean {
  return child.exitCode == null && !child.killed
}

function getActiveAgentForProfile(profileId: string): { pid: number; startedAt: string } | null {
  for (const [pid, info] of activeAgents.entries()) {
    if (info.profileId !== profileId) continue
    if (!isProcessActive(info.child)) {
      activeAgents.delete(pid)
      continue
    }
    return { pid, startedAt: info.startedAt }
  }
  return null
}

export async function spawnAgent(profileId: string): Promise<{ pid: number; profile_id: string; started_at: string }> {
  const existing = getActiveAgentForProfile(profileId)
  if (existing) {
    return {
      pid: existing.pid,
      profile_id: profileId,
      started_at: existing.startedAt,
    }
  }

  const config = await getConfig()
  const port = Number(config.server?.port || DEFAULT_PORT)

  const workspaceRoot = process.cwd()
  const agentEntryPath = join(workspaceRoot, 'apps', 'agent', 'src', 'index.ts')

  const child = spawn('tsx', [agentEntryPath, `--profile=${profileId}`, `--server-url=http://localhost:${port}`], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    cwd: workspaceRoot,
    env: {
      ...process.env,
    },
  })

  const pid = child.pid!
  const started_at = new Date().toISOString()

  activeAgents.set(pid, { profileId, child, startedAt: started_at })

  const db = await getDb()
  db.run(`INSERT OR REPLACE INTO running_agents (pid, profile_id, started_at, last_heartbeat, heartbeat_message)
    VALUES (?, ?, ?, ?, ?)`, [pid, profileId, started_at, started_at, 'spawned'])
  saveDb(db)

  child.on('error', (err) => {
    console.error(`[agent:${profileId}] Process error:`, err.message)
    activeAgents.delete(pid)
    cleanupAgent(pid)
  })

  child.on('exit', () => {
    if (!activeAgents.has(pid)) return
    activeAgents.delete(pid)
    cleanupAgent(pid)
  })

  child.stdout?.on('data', (data) => {
    console.log(`[agent:${profileId}] ${data.toString().trim()}`)
  })

  child.stderr?.on('data', (data) => {
    console.error(`[agent:${profileId}] ${data.toString().trim()}`)
  })

  return { pid, profile_id: profileId, started_at }
}

async function cleanupAgent(pid: number) {
  const db = await getDb()
  db.run(`DELETE FROM running_agents WHERE pid = ?`, [pid])
  saveDb(db)
}

export async function killAllAgents(): Promise<void> {
  const pids = Array.from(activeAgents.keys())
  for (const pid of pids) {
    const agent = activeAgents.get(pid)
    if (!agent) continue
    agent.child.kill('SIGTERM')
    activeAgents.delete(pid)
    await cleanupAgent(pid)
  }
}

export async function killAgent(pid: number, graceMs = 10000): Promise<boolean> {
  const agent = activeAgents.get(pid)
  if (!agent) return false

  agent.child.kill('SIGTERM')

  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      agent.child.kill('SIGKILL')
      resolve(false)
    }, graceMs)
    agent.child.on('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

  activeAgents.delete(pid)
  await cleanupAgent(pid)

  if (!exited) {
    console.warn(`[spawner] Agent ${pid} had to be SIGKILL'd`)
  }

  return true
}

export async function heartbeatAgent(pid: number, message?: string) {
  const db = await getDb()
  const ts = new Date().toISOString()
  db.run(`UPDATE running_agents SET last_heartbeat = ?, heartbeat_message = ? WHERE pid = ?`, [ts, message || '', pid])
  saveDb(db)

  return { pid, last_heartbeat: ts }
}

export async function getActiveAgents(): Promise<Array<{ pid: number; profile_id: string; started_at: string; last_heartbeat?: string; heartbeat_message?: string }>> {
  try {
    const db = await getDb()
    const result = db.exec(`SELECT pid, profile_id, started_at, last_heartbeat, heartbeat_message FROM running_agents`)
    if (!result.length || !result[0].values.length) return []

    return result[0].values.map((row) => ({
      pid: Number(row[0]),
      profile_id: String(row[1] || ''),
      started_at: String(row[2] || ''),
      last_heartbeat: String(row[3] || ''),
      heartbeat_message: String(row[4] || ''),
    }))
  } catch {
    return []
  }
}

export function startHeartbeatWatchdog(intervalMs = 15000): ReturnType<typeof setInterval> {
  const watchdog = setInterval(async () => {
    for (const [pid, info] of activeAgents.entries()) {
      if (!isProcessActive(info.child)) {
        console.warn(`[watchdog] Agent ${pid} (${info.profileId}) is dead, cleaning up`)
        activeAgents.delete(pid)
        await cleanupAgent(pid)
      }
    }
  }, intervalMs)
  watchdog.unref()
  return watchdog
}

export function listAvailableProfiles(): Array<{ id: string; name: string; role: string }> {
  return [
    { id: 'kosmos', name: 'Kosmos', role: 'Orchestrator' },
    { id: 'vicks', name: 'Vicks', role: 'Developer' },
    { id: 'wedge', name: 'Wedge', role: 'QA' },
  ]
}
