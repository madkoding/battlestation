import Fastify from 'fastify'
import cors from '@fastify/cors'
import { registerRoutes } from './routes'
import { registerMCPRoutes } from './routes/mcp'
import { registerSettingsRoutes } from './routes/settings'
import { runMigrations } from './db/migrate'
import { initWebSocketServer, closeWebSocketServer } from './ws-server'
import { getConfig } from './services/config'
import { spawnAgent, killAllAgents, startHeartbeatWatchdog } from './services/agent-spawner'

const PORT = 18792

async function main() {
  await runMigrations()

  const { getDb, saveDb } = await import('./db/sqlite-client')
  const db = await getDb()
  db.run('DELETE FROM running_agents')
  saveDb(db)
  console.log('[server] Cleared stale agent records')

  startHeartbeatWatchdog()

  const config = await getConfig()
  const actualPort = config.server?.port || PORT
  const actualWsPort = actualPort + 1

  const fastify = Fastify({ logger: true })

  await fastify.register(cors, {
    origin: config.server?.cors_origins || ['*'],
  })

  await registerRoutes(fastify)
  await registerMCPRoutes(fastify)
  await registerSettingsRoutes(fastify)

  initWebSocketServer(actualWsPort)

  spawnAgent('kosmos').then((result) => {
    console.log(`[server] Kosmos agent spawned (PID: ${result.pid})`)
  }).catch((err) => {
    console.error('[server] Failed to spawn Kosmos agent:', err)
  })

  const shutdown = async () => {
    console.log('[server] Shutting down...')
    await killAllAgents()
    closeWebSocketServer()
    await fastify.close()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await fastify.listen({ port: actualPort, host: '0.0.0.0' })
    console.log(`[server] REST API on http://localhost:${actualPort}`)
    console.log(`[server] MCP on http://localhost:${actualPort}/mcp`)
    console.log(`[server] WebSocket on ws://localhost:${actualWsPort}`)
    console.log(`[server] Kosmos agent spawned as child process`)
  } catch (err: unknown) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
