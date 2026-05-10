import test from 'node:test'
import assert from 'node:assert/strict'

import { runMigrations } from '../db/migrate'
import { createProject, createTask, addComment, getCommentsPaginated } from './kanban'

test('getCommentsPaginated returns stable non-overlapping pages', async () => {
  await runMigrations()

  const seed = Date.now().toString(36)
  const project = await createProject({
    name: `comments-pagination-project-${seed}`,
    path: `/tmp/comments-pagination-project-${seed}`,
    description: 'pagination stability test',
  })
  assert.ok(project)

  const task = await createTask({
    project_id: String(project?.id || ''),
    title: `comments pagination task ${seed}`,
    description: 'ensures deterministic ordering',
    priority: 'medium',
  })
  assert.ok(task)

  const taskId = String(task.id || '')
  assert.ok(taskId.length > 0)

  for (let i = 1; i <= 12; i += 1) {
    await addComment(taskId, `seed-comment-${i}`, 'tester')
  }

  const firstPage = await getCommentsPaginated(taskId, { limit: 5, offset: 0, order: 'desc' })
  const secondPage = await getCommentsPaginated(taskId, { limit: 5, offset: 5, order: 'desc' })

  assert.equal(firstPage.comments.length, 5)
  assert.equal(secondPage.comments.length, 5)
  assert.equal(firstPage.total, 12)
  assert.equal(secondPage.total, 12)
  assert.equal(firstPage.next_offset, 5)
  assert.equal(secondPage.next_offset, 10)

  const firstIds = new Set(firstPage.comments.map((comment) => String(comment.id || '')))
  const overlap = secondPage.comments.some((comment) => firstIds.has(String(comment.id || '')))
  assert.equal(overlap, false)
})
