import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { runMigrations } from '../db/migrate'
import {
  createProject,
  createTask,
  getProject,
  getTask,
  getTasks,
  listProjects,
  updateProject,
  updateTask,
  moveTask,
  rejectTask,
  deleteTask,
  addComment,
  getComments,
  deleteProject,
  touchTaskActivity,
} from './kanban'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
}

function makeTempRepo(): string {
  const dir = `/tmp/kanban-test-repo-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# test\n')
  execSync('git init', { cwd: dir, encoding: 'utf-8' })
  execSync('git config user.name test && git config user.email test@test.com', { cwd: dir, encoding: 'utf-8' })
  execSync('git add . && git commit -m "initial"', { cwd: dir, encoding: 'utf-8', env: GIT_ENV })
  return dir
}

const seed = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

test('listProjects returns empty initially', async () => {
  await runMigrations()
  const projects = await listProjects()
  assert.ok(Array.isArray(projects))
})

test('createProject and getProject round trip', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `test-${id}`, path: `/tmp/test-${id}`, description: 'test' })
  assert.ok(project)
  assert.equal(project!.name, `test-${id}`)
  assert.equal(project!.path, `/tmp/test-${id}`)

  const fetched = await getProject(String(project!.id))
  assert.ok(fetched)
  assert.equal(fetched!.name, `test-${id}`)
})

test('updateProject modifies fields', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `old-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)

  const updated = await updateProject(String(project!.id), { name: `new-${id}`, color: '#ff0' })
  assert.ok(updated)
  assert.equal(updated!.name, `new-${id}`)
  assert.equal(updated!.color, '#ff0')
})

test('deleteProject removes project and its tasks', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `del-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'to-delete' })

  await deleteProject(String(project!.id))

  const deletedProject = await getProject(String(project!.id))
  assert.equal(deletedProject, null)
  const deletedTask = await getTask(String(task!.id))
  assert.equal(deletedTask, null)
})

test('createTask sets defaults', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `task-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'my task', priority: 'high' })

  assert.equal(task!.title, 'my task')
  assert.equal(task!.priority, 'high')
  assert.equal(task!.status, 'todo')
  assert.equal(task!.task_kind, 'task')
})

test('updateTask only updates specified fields', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `ut-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'original' })

  const updated = await updateTask(String(task!.id), { title: 'changed' })
  assert.ok(updated)
  assert.equal(updated!.title, 'changed')
  assert.equal(updated!.priority, 'medium')
})

test('getTasks filters by project and status', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `gt-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  await createTask({ project_id: String(project!.id), title: 'task A' })
  await createTask({ project_id: String(project!.id), title: 'task B' })

  const tasks = await getTasks(String(project!.id))
  assert.equal(tasks.length, 2)

  const otherId = seed()
  const otherProject = await createProject({ name: `gt2-${otherId}`, path: `/tmp/test-${id}` })
  assert.ok(otherProject)
  const otherTasks = await getTasks(String(otherProject!.id))
  assert.equal(otherTasks.length, 0)
})

test('moveTask todo to progress and progress to todo', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `mv-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'movable' })

  const progress = await moveTask(String(task!.id), 'progress', 'vicks')
  assert.ok(progress)
  assert.equal(progress!.status, 'progress')
  assert.equal(progress!.assigned_to, 'vicks')

  const back = await moveTask(String(task!.id), 'todo')
  assert.ok(back)
  assert.equal(back!.status, 'todo')
})

test('moveTask qa to done with git repo', async () => {
  await runMigrations()
  const repoDir = makeTempRepo()
  try {
    const id = seed()
    const project = await createProject({ name: `mv-qa-${id}`, path: repoDir })
    assert.ok(project)
    const task = await createTask({ project_id: String(project!.id), title: 'movable qa' })
    assert.ok(task)

    await moveTask(String(task!.id), 'progress', 'vicks')

    const branchName = `task/${String(task!.id).slice(0, 8)}`
    const worktreePath = join(repoDir, '.worktrees', branchName)
    if (existsSync(worktreePath)) {
      writeFileSync(join(worktreePath, 'change.txt'), 'new content')
      execSync('git add . && git commit -m "new file"', { cwd: worktreePath, encoding: 'utf-8', env: GIT_ENV })
    }

    const qa = await moveTask(String(task!.id), 'qa', 'vicks', 'ready for review')
    assert.ok(qa)
    assert.equal(qa!.status, 'qa')

    const done = await moveTask(String(task!.id), 'done')
    assert.ok(done)
    assert.equal(done!.status, 'done')
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('moveTask invalid transitions throw', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `inv-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'invalid moves' })

  await assert.rejects(() => moveTask(String(task!.id), 'done'), /Invalid transition/)
  await assert.rejects(() => moveTask(String(task!.id), 'qa'), /Invalid transition/)
})

test('rejectTask moves qa -> progress', async () => {
  await runMigrations()
  const repoDir = makeTempRepo()
  try {
    const id = seed()
    const project = await createProject({ name: `rej-${id}`, path: repoDir })
    assert.ok(project)
    const task = await createTask({ project_id: String(project!.id), title: 'rejectable' })
    assert.ok(task)

    await moveTask(String(task!.id), 'progress', 'vicks')

    const branchName = `task/${String(task!.id).slice(0, 8)}`
    const worktreePath = join(repoDir, '.worktrees', branchName)
    if (existsSync(worktreePath)) {
      writeFileSync(join(worktreePath, 'change.txt'), 'content')
      execSync('git add . && git commit -m "change"', { cwd: worktreePath, encoding: 'utf-8', env: GIT_ENV })
    }

    await moveTask(String(task!.id), 'qa')
    const rejected = await rejectTask(String(task!.id), 'needs work', 'wedge')
    assert.ok(rejected)
    assert.equal(rejected!.status, 'progress')
    assert.equal(rejected!.assigned_to, 'vicks')
  } finally {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

test('rejectTask throws on non-qa tasks', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `rej2-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'cant-reject' })

  await assert.rejects(() => rejectTask(String(task!.id), 'no'), /Can only reject tasks in QA/)
})

test('deleteTask removes task and related data', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `deltask-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'delete-me' })

  await addComment(String(task!.id), 'a comment', 'tester')
  await deleteTask(String(task!.id))

  const deleted = await getTask(String(task!.id))
  assert.equal(deleted, null)
  const comments = await getComments(String(task!.id))
  assert.equal(comments.length, 0)
})

test('addComment stores comment and returns it', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `comment-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'comment-test' })

  const comment = await addComment(String(task!.id), 'hello world', 'tester')
  assert.ok(comment)
  assert.equal(comment!.comment, 'hello world')
  assert.equal(comment!.agent_name, 'tester')
})

test('addComment increments escalation_count on escalation marker', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `esc-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'escalation-test' })

  await addComment(String(task!.id), '## Delivery Escalation Required\nneeds help', 'vicks')
  const updated = await getTask(String(task!.id))
  assert.ok(updated)
  assert.equal(updated!.escalation_count, 1)
})

test('touchTaskActivity updates updated_at', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `touch-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'touch' })

  const touched = await touchTaskActivity(String(task!.id), 'bot')
  assert.ok(touched)
  assert.ok(new Date(String(touched!.updated_at)) > new Date(String(task!.updated_at)))
})

test('touchTaskActivity with clearAssignment empties assigned_to', async () => {
  await runMigrations()
  const id = seed()
  const project = await createProject({ name: `touch2-${id}`, path: `/tmp/test-${id}` })
  assert.ok(project)
  const task = await createTask({ project_id: String(project!.id), title: 'touch-clear' })
  await moveTask(String(task!.id), 'progress', 'vicks')

  const cleared = await touchTaskActivity(String(task!.id), '', true)
  assert.ok(cleared)
  assert.equal(cleared!.assigned_to, '')
})
