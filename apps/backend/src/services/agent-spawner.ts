import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { getDb, saveDb } from '../db/sqlite-client'
import { getConfig } from './config'

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
  const port = Number(config.server?.port || 18792)

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
    VALUES (${pid}, '${profileId}', '${started_at}', '${started_at}', 'spawned')`)
  saveDb(db)

  child.on('exit', () => {
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
  db.run(`DELETE FROM running_agents WHERE pid = ${pid}`)
  saveDb(db)
}

export async function killAgent(pid: number): Promise<boolean> {
  const agent = activeAgents.get(pid)
  if (!agent) return false

  agent.child.kill('SIGTERM')
  activeAgents.delete(pid)
  await cleanupAgent(pid)

  return true
}

export async function heartbeatAgent(pid: number, message?: string) {
  const db = await getDb()
  const ts = new Date().toISOString()
  const msg = String(message || '').replace(/'/g, "''")
  db.run(`UPDATE running_agents SET last_heartbeat = '${ts}', heartbeat_message = '${msg}' WHERE pid = ${pid}`)
  saveDb(db)

  return { pid, last_heartbeat: ts }
}

export function getActiveAgents(): Array<{ pid: number; profile_id: string; started_at: string; last_heartbeat?: string; heartbeat_message?: string }> {
  return Array.from(activeAgents.entries()).map(([pid, { profileId, startedAt }]) => ({
    pid,
    profile_id: profileId,
    started_at: startedAt,
    last_heartbeat: new Date().toISOString(),
    heartbeat_message: 'running',
  }))
}

export function listAvailableProfiles(): Array<{ id: string; name: string; role: string }> {
  return [
    { id: 'kosmos', name: 'Kosmos', role: 'Orchestrator' },
    { id: 'vicks', name: 'Vicks', role: 'Developer' },
    { id: 'wedge', name: 'Wedge', role: 'QA' },
  ]
}
