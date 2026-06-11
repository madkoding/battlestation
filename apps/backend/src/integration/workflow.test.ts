import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { runMigrations } from '../db/migrate'
import { registerRoutes } from '../routes'
import { registerMCPRoutes } from '../routes/mcp'
import { getTask, deleteProject, deleteTask } from '../services/kanban'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const seed = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function createTestApp() {
  await runMigrations()
  const app = Fastify()
  await registerRoutes(app)
  await registerMCPRoutes(app)
  await app.ready()
  return app
}

interface MCPResponse {
  jsonrpc: string
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

async function mcpcall(app: Awaited<ReturnType<typeof createTestApp>>, method: string, params: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method, params: { ...params, _agent: 'test' } },
  })
  return JSON.parse(res.body) as MCPResponse
}

function makeTempRepo(): string {
  const dir = `/tmp/integration-repo-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# test\n')
  execSync('git init', { cwd: dir, encoding: 'utf-8' })
  execSync('git config user.name test && git config user.email test@test.com', { cwd: dir, encoding: 'utf-8' })
  execSync('git add . && git commit -m "initial"', { cwd: dir, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' } })
  return dir
}

test('MCP: list_projects returns empty array', async () => {
  const app = await createTestApp()
  const res = await mcpcall(app, 'list_projects')
  assert.equal(res.jsonrpc, '2.0')
  assert.ok(Array.isArray(res.result))
})

test('MCP: create_project and get_project round trip', async () => {
  const app = await createTestApp()
  const id = seed()
  const res = await mcpcall(app, 'create_project', { name: `mcp-${id}`, path: `/tmp/mcp-${id}` })
  assert.ok(res.result)
  const projectId = String((res.result as Record<string, unknown>).id)

  const got = await mcpcall(app, 'get_project', { id: projectId })
  assert.ok(got.result)
  assert.equal((got.result as Record<string, unknown>).name, `mcp-${id}`)

  await deleteProject(projectId)
})

test('MCP: get_project returns error for missing project', async () => {
  const app = await createTestApp()
  const res = await mcpcall(app, 'get_project', { id: 'nonexistent' })
  assert.ok(res.error)
  assert.equal(res.error!.code, -32000)
})

test('MCP: create_task and get_task round trip', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `ct-${id}`, path: `/tmp/ct-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)

  const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'test task', priority: 'high' })
  assert.ok(taskRes.result)
  const taskId = String((taskRes.result as Record<string, unknown>).id)
  assert.equal((taskRes.result as Record<string, unknown>).title, 'test task')
  assert.equal((taskRes.result as Record<string, unknown>).status, 'todo')

  const got = await mcpcall(app, 'get_task', { id: taskId })
  assert.ok(got.result)

  await deleteTask(taskId)
  await deleteProject(projectId)
})

test('MCP: get_tasks filters by project and status', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `gt-${id}`, path: `/tmp/gt-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)

  await mcpcall(app, 'create_task', { project_id: projectId, title: 'task 1' })
  await mcpcall(app, 'create_task', { project_id: projectId, title: 'task 2' })

  const res = await mcpcall(app, 'get_tasks', { project_id: projectId })
  assert.ok(Array.isArray(res.result))
  assert.equal((res.result as unknown[]).length, 2)

  const projects = await mcpcall(app, 'list_projects')
  assert.ok((projects.result as unknown[]).length >= 1)
})

test('MCP: move_task valid transitions', async () => {
  const app = await createTestApp()
  const repoDir = makeTempRepo()
  try {
    const id = seed()
    const projRes = await mcpcall(app, 'create_project', { name: `mv-${id}`, path: repoDir })
    const projectId = String((projRes.result as Record<string, unknown>).id)

    const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'movable' })
    const taskId = String((taskRes.result as Record<string, unknown>).id)

    const pRes = await mcpcall(app, 'move_task', { id: taskId, to_status: 'progress', agent_name: 'vicks' })
    assert.ok(pRes.result)
    assert.equal((pRes.result as Record<string, unknown>).status, 'progress')

    const tRes = await mcpcall(app, 'move_task', { id: taskId, to_status: 'todo' })
    assert.ok(tRes.result)
    assert.equal((tRes.result as Record<string, unknown>).status, 'todo')
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('MCP: move_task invalid transition returns error', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `inv-${id}`, path: `/tmp/inv-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)

  const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'invalid' })
  const taskId = String((taskRes.result as Record<string, unknown>).id)

  const res = await mcpcall(app, 'move_task', { id: taskId, to_status: 'done' })
  assert.ok(res.error)
  assert.equal(res.error!.code, -32000)
  assert.ok(String(res.error!.message).includes('Invalid transition'))
})

test('MCP: add_comment and get_comments', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `cm-${id}`, path: `/tmp/cm-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)
  const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'comments' })
  const taskId = String((taskRes.result as Record<string, unknown>).id)

  const addRes = await mcpcall(app, 'add_comment', { task_id: taskId, comment: 'hello', agent_name: 'tester' })
  assert.ok(addRes.result)

  const getRes = await mcpcall(app, 'get_comments', { task_id: taskId })
  assert.ok(Array.isArray(getRes.result))
  assert.equal((getRes.result as unknown[]).length, 1)
})

test('MCP: reject_task moves qa -> progress', async () => {
  const app = await createTestApp()
  const repoDir = makeTempRepo()
  try {
    const id = seed()
    const projRes = await mcpcall(app, 'create_project', { name: `rej-${id}`, path: repoDir })
    const projectId = String((projRes.result as Record<string, unknown>).id)
    const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'rejectable' })
    const taskId = String((taskRes.result as Record<string, unknown>).id)

    await mcpcall(app, 'move_task', { id: taskId, to_status: 'progress', agent_name: 'vicks' })

    const branchName = `task/${taskId.slice(0, 8)}`
    const wtPath = join(repoDir, '.worktrees', branchName)
    if (existsSync(wtPath)) {
      writeFileSync(join(wtPath, 'change.txt'), 'content')
      execSync('git add . && git commit -m "change"', { cwd: wtPath, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' } })
    }

    await mcpcall(app, 'move_task', { id: taskId, to_status: 'qa' })
    const rejRes = await mcpcall(app, 'reject_task', { id: taskId, reason: 'needs work' })
    assert.ok(rejRes.result)
    assert.equal((rejRes.result as Record<string, unknown>).status, 'progress')
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('MCP: unknown method returns error', async () => {
  const app = await createTestApp()
  const res = await mcpcall(app, 'nonexistent_method')
  assert.ok(res.error)
  assert.equal(res.error!.code, -32601)
})

test('MCP: touch_task updates timestamp', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `touch-${id}`, path: `/tmp/touch-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)
  const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'touchable' })
  const taskId = String((taskRes.result as Record<string, unknown>).id)

  const touchRes = await mcpcall(app, 'touch_task', { task_id: taskId, agent_name: 'bot' })
  assert.ok(touchRes.result)
})

test('MCP: get_config returns config', async () => {
  const app = await createTestApp()
  const res = await mcpcall(app, 'get_config')
  assert.ok(res.result)
  assert.ok(typeof (res.result as Record<string, unknown>).server === 'object')
})

test('MCP: delete_project and delete_task', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `del-${id}`, path: `/tmp/del-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)
  const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'deletable' })
  const taskId = String((taskRes.result as Record<string, unknown>).id)

  const delTaskRes = await mcpcall(app, 'delete_project', { id: projectId })
  assert.ok(delTaskRes.result)

  const gotTask = await mcpcall(app, 'get_task', { id: taskId })
  assert.ok(gotTask.error)
})

test('MCP: git_init and git_create_worktree', async () => {
  const app = await createTestApp()
  const repoDir = makeTempRepo()
  try {
    const initRes = await mcpcall(app, 'git_init', { path: repoDir })
    assert.ok(initRes.result)

    const wtRes = await mcpcall(app, 'git_create_worktree', { path: repoDir, branch_name: 'feature/test', task_id: 'test-999' })
    assert.ok(wtRes.result)
    assert.ok(existsSync(join(repoDir, '.worktrees', 'feature/test')))
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('MCP: get_tools lists available tools', async () => {
  const app = await createTestApp()
  const res = await app.inject({ method: 'GET', url: '/mcp/tools' })
  const tools = JSON.parse(res.body) as Array<{ name: string }>
  assert.ok(tools.length > 20)
  assert.ok(tools.some((t) => t.name === 'create_project'))
  assert.ok(tools.some((t) => t.name === 'move_task'))
  assert.ok(tools.some((t) => t.name === 'workspace_write'))
})

test('REST: POST /api/projects with Zod validation', async () => {
  const app = await createTestApp()
  const id = seed()
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: `rest-${id}`, path: `/tmp/rest-${id}` },
  })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body) as Record<string, unknown>
  assert.equal(body.name, `rest-${id}`)
})

test('REST: POST /api/projects with missing name returns 500', async () => {
  const app = await createTestApp()
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {},
  })
  assert.equal(res.statusCode, 500)
})

test('REST: GET /health returns ok', async () => {
  const app = await createTestApp()
  const res = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body) as Record<string, unknown>
  assert.equal(body.status, 'ok')
})

test('REST: GET /api/projects/:id/tasks returns task list', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: `rt-${id}`, path: `/tmp/rt-${id}` },
  })
  const project = JSON.parse(projRes.body) as Record<string, unknown>

  await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/tasks`,
    payload: { title: 'rest task' },
  })

  const listRes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/tasks` })
  assert.equal(listRes.statusCode, 200)
  const tasks = JSON.parse(listRes.body) as Record<string, unknown>[]
  assert.equal(tasks.length, 1)
})

test('REST: POST /api/tasks/:id/transition', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: `tr-${id}`, path: `/tmp/tr-${id}` },
  })
  const project = JSON.parse(projRes.body) as Record<string, unknown>

  const taskRes = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/tasks`,
    payload: { title: 'transition test' },
  })
  const task = JSON.parse(taskRes.body) as Record<string, unknown>

  const transRes = await app.inject({
    method: 'POST',
    url: `/api/tasks/${task.id}/transition`,
    payload: { to_status: 'progress', agent_name: 'vicks' },
  })
  assert.equal(transRes.statusCode, 200)
  const moved = JSON.parse(transRes.body) as Record<string, unknown>
  assert.equal(moved.status, 'progress')
})

test('REST: GET /api/tasks/:id returns task', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: `gtask-${id}`, path: `/tmp/gtask-${id}` },
  })
  const project = JSON.parse(projRes.body) as Record<string, unknown>

  const taskRes = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/tasks`,
    payload: { title: 'gettable' },
  })
  const task = JSON.parse(taskRes.body) as Record<string, unknown>

  const getRes = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}` })
  assert.equal(getRes.statusCode, 200)
  const fetched = JSON.parse(getRes.body) as Record<string, unknown>
  assert.equal(fetched.title, 'gettable')
})

test('REST: GET /api/tasks/:id context', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: `ctx-${id}`, path: `/tmp/ctx-${id}` },
  })
  const project = JSON.parse(projRes.body) as Record<string, unknown>

  const taskRes = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/tasks`,
    payload: { title: 'context test' },
  })
  const task = JSON.parse(taskRes.body) as Record<string, unknown>

  const ctxRes = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/context` })
  assert.equal(ctxRes.statusCode, 200)
  const ctx = JSON.parse(ctxRes.body) as Record<string, unknown>
  assert.ok(ctx.task)
  assert.ok(ctx.project)
  assert.ok(Array.isArray(ctx.comments))
})

test('REST: GET /api/config returns config', async () => {
  const app = await createTestApp()
  const res = await app.inject({ method: 'GET', url: '/api/config' })
  assert.equal(res.statusCode, 200)
  const config = JSON.parse(res.body) as Record<string, unknown>
  assert.ok(config)
})

test('REST: GET /api/activity/live returns activities', async () => {
  const app = await createTestApp()
  const res = await app.inject({ method: 'GET', url: '/api/activity/live' })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body) as Record<string, unknown>
  assert.ok(Array.isArray(body.activities))
})

test('REST: GET /api/tasks/metrics returns totals', async () => {
  const app = await createTestApp()
  const res = await app.inject({ method: 'GET', url: '/api/tasks/metrics' })
  assert.equal(res.statusCode, 200)
  const metrics = JSON.parse(res.body) as Record<string, unknown>
  assert.ok(typeof metrics.todo === 'number')
  assert.ok(typeof metrics.progress === 'number')
  assert.ok(typeof metrics.qa === 'number')
  assert.ok(typeof metrics.done === 'number')
})

test('REST: DELETE /api/projects/:id removes project', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: `rdel-${id}`, path: `/tmp/rdel-${id}` },
  })
  const project = JSON.parse(projRes.body) as Record<string, unknown>

  const delRes = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` })
  assert.equal(delRes.statusCode, 200)

  const getRes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })
  assert.equal(getRes.statusCode, 404)
})

test('MCP: git_list_worktree_artifacts reports changes', async () => {
  const app = await createTestApp()
  const repoDir = makeTempRepo()
  try {
    const wtRes = await mcpcall(app, 'git_create_worktree', { path: repoDir, branch_name: 'feature/artifact-test', task_id: 'task-777' })
    const wtPath = (wtRes.result as Record<string, unknown>).worktree_path as string

    writeFileSync(join(wtPath, 'new-file.txt'), 'data')
    execSync('git add . && git commit -m "add file"', { cwd: wtPath, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com' } })

    const artRes = await mcpcall(app, 'git_list_worktree_artifacts', {
      worktree_path: wtPath,
      repo_path: repoDir,
      base_branch: 'master',
      work_branch: 'feature/artifact-test',
    })
    assert.ok(artRes.result)
    const artifacts = artRes.result as { changed_files: string[]; files_between_branches: string[] }
    assert.ok(Array.isArray(artifacts.changed_files))
    assert.ok(artifacts.changed_files.length >= 1 || artifacts.files_between_branches.length >= 1)
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('MCP: add_comment increments escalation on marker', async () => {
  const app = await createTestApp()
  const id = seed()
  const projRes = await mcpcall(app, 'create_project', { name: `esc-${id}`, path: `/tmp/esc-${id}` })
  const projectId = String((projRes.result as Record<string, unknown>).id)
  const taskRes = await mcpcall(app, 'create_task', { project_id: projectId, title: 'escalation' })
  const taskId = String((taskRes.result as Record<string, unknown>).id)

  await mcpcall(app, 'add_comment', { task_id: taskId, comment: '## Delivery Escalation Required\nhelp', agent_name: 'vicks' })

  const task = await getTask(taskId)
  assert.ok(task)
  assert.equal(task!.escalation_count, 1)
})
