import { WebSocketServer, WebSocket } from 'ws'
import { saveLiveActivityEvent } from './services/live-activity'

const clients = new Set<WebSocket>()

let wss: WebSocketServer | null = null

export function initWebSocketServer(port: number) {
  wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    clients.add(ws)
    console.log(`[ws] Client connected. Total: ${clients.size}`)

    ws.on('close', () => {
      clients.delete(ws)
      console.log(`[ws] Client disconnected. Total: ${clients.size}`)
    })

    ws.on('error', (err) => {
      console.error('[ws] Error:', err)
      clients.delete(ws)
    })
  })

  console.log(`[ws] WebSocket server on port ${port}`)
  return wss
}

export function broadcast(message: object) {
  const envelope = message as { type?: string; payload?: Record<string, unknown> }
  if (envelope.type === 'activity' && envelope.payload) {
    void saveLiveActivityEvent(envelope.payload)
  }

  const data = JSON.stringify(message)
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data)
      } catch {
        clients.delete(client)
      }
    }
  })
}

export function getClientCount() {
  return clients.size
}

export function closeWebSocketServer() {
  if (wss) {
    wss.close()
    wss = null
  }
}
