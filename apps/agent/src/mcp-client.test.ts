import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'
import { MCPClient } from './mcp-client'

function createMockMCP(): { server: Server; port: number; requests: Array<{ method: string; params: Record<string, unknown> }> } {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      if (parsed.method === 'list_projects') {
        requests.push({ method: 'list_projects', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: [] }))
      } else if (parsed.method === 'get_tasks') {
        requests.push({ method: 'get_tasks', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: [{ id: 'task-1', title: 'Test', status: 'todo' }] }))
      } else if (parsed.method === 'move_task') {
        requests.push({ method: 'move_task', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { id: String(parsed.params.id), status: String(parsed.params.to_status) } }))
      } else if (parsed.method === 'error_method') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32000, message: 'Something went wrong' } }))
      } else if (parsed.method === 'unknown_method') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'Method not found' } }))
      } else if (parsed.method === 'add_comment') {
        requests.push({ method: 'add_comment', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { id: 'comment-1', comment: String(parsed.params.comment) } }))
      } else if (parsed.method === 'spawn_agent') {
        requests.push({ method: 'spawn_agent', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { pid: 12345 } }))
      } else if (parsed.method === 'get_comments') {
        requests.push({ method: 'get_comments', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: [{ id: 'c1', comment: 'test', agent_name: 'bot' }] }))
      } else if (parsed.method === 'heartbeat_agent') {
        requests.push({ method: 'heartbeat_agent', params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { ok: true } }))
      } else if (parsed.method === 'http_error') {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal Server Error' }))
      } else {
        requests.push({ method: parsed.method, params: parsed.params })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }))
      }
    })
  })
  server.listen(0)
  const port = (server.address() as AddressInfo).port
  return { server, port, requests }
}

test('MCPClient: listProjects returns empty array', async () => {
  const { server, port, requests } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.listProjects()
    assert.ok(Array.isArray(result))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'list_projects')
  } finally {
    server.close()
  }
})

test('MCPClient: getTasks returns tasks', async () => {
  const { server, port, requests } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.getTasks('proj-1', 'todo')
    assert.ok(Array.isArray(result))
    assert.equal(result.length, 1)
    assert.equal(requests[0].method, 'get_tasks')
  } finally {
    server.close()
  }
})

test('MCPClient: moveTask returns result', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.moveTask('task-1', 'progress', 'vicks', 'working')
    assert.ok(result)
    assert.equal((result as Record<string, unknown>).status, 'progress')
  } finally {
    server.close()
  }
})

test('MCPClient: addComment returns comment', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.addComment('task-1', 'hello world', 'test')
    assert.ok(result)
    assert.equal((result as Record<string, unknown>).comment, 'hello world')
  } finally {
    server.close()
  }
})

test('MCPClient: spawnAgent returns pid', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.spawnAgent('vicks')
    assert.ok(result)
    const record = result as Record<string, unknown>
    assert.equal(record.pid, 12345)
  } finally {
    server.close()
  }
})

test('MCPClient: heartbeatAgent does not include _agent param', async () => {
  const { server, port, requests } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    await client.heartbeatAgent(999, 'test heartbeat')
    assert.equal(requests[0].method, 'heartbeat_agent')
    assert.ok(!('_agent' in requests[0].params))
    assert.equal(requests[0].params.pid, 999)
  } finally {
    server.close()
  }
})

test('MCPClient: other tools include _agent param', async () => {
  const { server, port, requests } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    await client.listProjects()
    assert.equal(requests[0].method, 'list_projects')
    assert.equal(requests[0].params._agent, 'test')
  } finally {
    server.close()
  }
})

test('MCPClient: throws on MCP error response', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    await assert.rejects(
      () => (client as unknown as { callTool(tool: string): Promise<unknown> }).callTool('error_method'),
      /Something went wrong/,
    )
  } finally {
    server.close()
  }
})

test('MCPClient: throws on HTTP error', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    await assert.rejects(
      () => (client as unknown as { callTool(tool: string): Promise<unknown> }).callTool('http_error'),
      /MCP request failed/,
    )
  } finally {
    server.close()
  }
})

test('MCPClient: getComments fetches task comments', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.getComments('task-1')
    assert.ok(Array.isArray(result))
  } finally {
    server.close()
  }
})

test('MCPClient: getConfig returns config', async () => {
  const { server, port } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'test' })
    const result = await client.getConfig()
    assert.ok(typeof result === 'object')
  } finally {
    server.close()
  }
})

test('MCPClient: custom serverUrl is used', async () => {
  const { server, port, requests } = createMockMCP()
  try {
    const client = new MCPClient({ serverUrl: `http://localhost:${port}`, agentName: 'custom' })
    await client.listProjects()
    assert.equal(requests[0].params._agent, 'custom')
  } finally {
    server.close()
  }
})

test('MCPClient: default serverUrl is localhost:18792', () => {
  const client = new MCPClient()
  assert.ok(client instanceof MCPClient)
})
