import Fastify from 'fastify'
import cors from '@fastify/cors'
import { registerRoutes } from './routes'
import { registerMCPRoutes } from './routes/mcp'
import { registerSettingsRoutes } from './routes/settings'
import { runMigrations } from './db/migrate'
import { initWebSocketServer, closeWebSocketServer } from './ws-server'
import { getConfig } from './services/config'
import { spawnAgent, killAllAgents, startHeartbeatWatchdog } from './services/agent-spawner'
import { logger } from './lib/logger'

const B = '\x1b[1m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const MAGENTA = '\x1b[35m'
const GRAY = '\x1b[90m'
const R = '\x1b[0m'

const PORT = 18792

function printBanner(httpPort: number, wsPort: number) {
  const dashUrl = `http://localhost:18795`
  const httpUrl = `http://localhost:${httpPort}`
  const mcpUrl = `${httpUrl}/mcp`
  const wsUrl = `ws://localhost:${wsPort}`

  const rule = `  ${CYAN}────────────────────────────────────────────${R}`
  console.log()
  console.log(rule)
  console.log(`  ${CYAN}${B}   ⚡  B A T T L E S T A T I O N  ${R}`)
  console.log(`  ${CYAN}   AI Agent Orchestration Platform${R}`)
  console.log(rule)
  console.log()
  console.log(`  ${GREEN}${B}REST API${R}     ${GRAY}→${R}  ${GREEN}${httpUrl}${R}`)
  console.log(`  ${YELLOW}${B}MCP${R}          ${GRAY}→${R}  ${YELLOW}${mcpUrl}${R}`)
  console.log(`  ${MAGENTA}${B}WebSocket${R}    ${GRAY}→${R}  ${MAGENTA}${wsUrl}${R}`)
  console.log(`  ${CYAN}${B}Dashboard${R}   ${GRAY}→${R}  ${CYAN}${dashUrl}${R}`)
  console.log()
  console.log(rule)
  console.log()
}

async function main() {
  await runMigrations()

  const { getDb, saveDb } = await import('./db/sqlite-client')
  const db = await getDb()
  db.run('DELETE FROM running_agents')
  saveDb(db)
  logger.info('Cleared stale agent records')

  startHeartbeatWatchdog()

  const config = await getConfig()
  const actualPort = config.server?.port || PORT
  const actualWsPort = actualPort + 1

  const fastify = Fastify({
    logger: { level: 'warn' },
    disableRequestLogging: true,
  })

  await fastify.register(cors, {
    origin: config.server?.cors_origins || ['*'],
  })

  await registerRoutes(fastify)
  await registerMCPRoutes(fastify)
  await registerSettingsRoutes(fastify)

  initWebSocketServer(actualWsPort)

  spawnAgent('kosmos').then((result) => {
    logger.success(`Kosmos agent spawned (PID: ${result.pid})`)
  }).catch((err) => {
    logger.error('Failed to spawn Kosmos agent', err)
  })

  const shutdown = async () => {
    console.log()
    logger.warn('Shutting down...')
    console.log()
    await killAllAgents()
    closeWebSocketServer()
    await fastify.close()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await fastify.listen({ port: actualPort, host: '0.0.0.0' })
    printBanner(actualPort, actualWsPort)
  } catch (err: unknown) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
