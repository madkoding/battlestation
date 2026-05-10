import Fastify from 'fastify'
import cors from '@fastify/cors'
import { registerRoutes } from './routes'
import { registerMCPRoutes } from './routes/mcp'
import { registerSettingsRoutes } from './routes/settings'
import { runMigrations } from './db/migrate'
import { initWebSocketServer } from './ws-server'
import { getConfig } from './services/config'
import { startKosmosLoop, stopKosmosLoop } from './services/kosmos-loop'

const PORT = 18792

async function main() {
  await runMigrations()

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

  startKosmosLoop()

  const shutdown = async () => {
    console.log('[server] Shutting down...')
    stopKosmosLoop()
    await fastify.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await fastify.listen({ port: actualPort, host: '0.0.0.0' })
    console.log(`[server] REST API on http://localhost:${actualPort}`)
    console.log(`[server] MCP on http://localhost:${actualPort}/mcp`)
    console.log(`[server] WebSocket on ws://localhost:${actualWsPort}`)
    console.log(`[server] Kosmos autonomous loop running`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
