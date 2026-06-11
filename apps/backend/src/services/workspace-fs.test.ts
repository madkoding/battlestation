import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import {
  workspaceList,
  workspaceRead,
  workspaceWrite,
  workspaceEdit,
  workspaceMove,
  workspaceDelete,
  workspaceGlobSearch,
  workspaceSearch,
} from './workspace-fs'

function testDir(name: string): string {
  const dir = `/tmp/workspace-fs-test-${name}-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

test('workspaceList lists files in workspace', async () => {
  const dir = testDir('list')
  writeFileSync(join(dir, 'a.txt'), 'hello')
  writeFileSync(join(dir, 'b.txt'), 'world')

  const result = await workspaceList({ workspacePath: dir })
  assert.ok(result.ok)
  assert.equal(result.entries.length, 2)
  const names = result.entries.map((e) => e.path).sort()
  assert.deepEqual(names, ['a.txt', 'b.txt'])

  cleanDir(dir)
})

test('workspaceList rejects path outside workspace', async () => {
  const dir = testDir('traversal')
  const result = await workspaceList({ workspacePath: dir, path: '../etc' })
  assert.ok(!result.ok)
  assert.ok(result.error!.includes('outside workspace'))

  cleanDir(dir)
})

test('workspaceList rejects non-existent workspace', async () => {
  const result = await workspaceList({ workspacePath: '/tmp/nonexistent-workspace-12345' })
  assert.ok(!result.ok)
  assert.ok(result.error!.includes('does not exist'))
})

test('workspaceList rejects disallowed path', async () => {
  const result = await workspaceList({ workspacePath: '/etc' })
  assert.ok(!result.ok)
  assert.ok(result.error!.includes('allowed directory'))
})

test('workspaceWrite creates file with content', async () => {
  const dir = testDir('write')
  const result = await workspaceWrite({ workspacePath: dir, path: 'hello.txt', content: 'Hello, World!' })
  assert.ok(result.ok)
  assert.equal(result.path, 'hello.txt')

  const read = await workspaceRead({ workspacePath: dir, path: 'hello.txt' })
  assert.ok(read.ok)
  assert.equal(read.content, 'Hello, World!')

  cleanDir(dir)
})

test('workspaceWrite rejects path traversal', async () => {
  const dir = testDir('write-traversal')
  const result = await workspaceWrite({ workspacePath: dir, path: '../evil.txt', content: 'bad' })
  assert.ok(!result.ok)

  cleanDir(dir)
})

test('workspaceRead respects offset and limit', async () => {
  const dir = testDir('read')
  const content = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n')
  await workspaceWrite({ workspacePath: dir, path: 'lines.txt', content })

  const result = await workspaceRead({ workspacePath: dir, path: 'lines.txt', offset: 2, limit: 2 })
  assert.ok(result.ok)
  assert.equal(result.content, 'line2\nline3')
  assert.equal(result.start_line, 2)
  assert.equal(result.total_lines, 5)

  cleanDir(dir)
})

test('workspaceRead returns error for non-file path', async () => {
  const dir = testDir('read-nonfile')
  const result = await workspaceRead({ workspacePath: dir, path: '.' })
  assert.ok(!result.ok)
  assert.ok(result.error!.includes('not a file'))

  cleanDir(dir)
})

test('workspaceEdit replaces text', async () => {
  const dir = testDir('edit')
  await workspaceWrite({ workspacePath: dir, path: 'edit.txt', content: 'foo bar baz' })

  const result = await workspaceEdit({ workspacePath: dir, path: 'edit.txt', find: 'bar', replace: 'qux' })
  assert.ok(result.ok)
  assert.equal(result.replacements, 1)

  const read = await workspaceRead({ workspacePath: dir, path: 'edit.txt' })
  assert.equal(read.content, 'foo qux baz')

  cleanDir(dir)
})

test('workspaceEdit replaceAll works', async () => {
  const dir = testDir('edit-all')
  await workspaceWrite({ workspacePath: dir, path: 'edit-all.txt', content: 'a b a c a d' })

  const result = await workspaceEdit({ workspacePath: dir, path: 'edit-all.txt', find: 'a', replace: 'x', all: true })
  assert.ok(result.ok)
  assert.equal(result.replacements, 3)

  const read = await workspaceRead({ workspacePath: dir, path: 'edit-all.txt' })
  assert.equal(read.content, 'x b x c x d')

  cleanDir(dir)
})

test('workspaceMove moves file', async () => {
  const dir = testDir('move')
  await workspaceWrite({ workspacePath: dir, path: 'source.txt', content: 'move me' })

  const result = await workspaceMove({ workspacePath: dir, from: 'source.txt', to: 'dest.txt' })
  assert.ok(result.ok)
  assert.equal(result.from, 'source.txt')
  assert.equal(result.to, 'dest.txt')

  const read = await workspaceRead({ workspacePath: dir, path: 'dest.txt' })
  assert.ok(read.ok)
  assert.equal(read.content, 'move me')

  cleanDir(dir)
})

test('workspaceDelete deletes file', async () => {
  const dir = testDir('delete')
  await workspaceWrite({ workspacePath: dir, path: 'delete-me.txt', content: 'bye' })

  const result = await workspaceDelete({ workspacePath: dir, path: 'delete-me.txt' })
  assert.ok(result.ok)

  const read = await workspaceRead({ workspacePath: dir, path: 'delete-me.txt' })
  assert.ok(!read.ok)

  cleanDir(dir)
})

test('workspaceGlobSearch finds files by pattern', async () => {
  const dir = testDir('glob')
  writeFileSync(join(dir, 'foo.ts'), '')
  writeFileSync(join(dir, 'bar.ts'), '')
  writeFileSync(join(dir, 'foo.js'), '')

  const result = await workspaceGlobSearch({ workspacePath: dir, pattern: '*.ts' })
  assert.ok(result.ok)
  assert.equal(result.matches.length, 2)

  cleanDir(dir)
})

test('workspaceSearch finds text in files', async () => {
  const dir = testDir('search')
  writeFileSync(join(dir, 'hello.txt'), 'hello world\nfoo bar')
  writeFileSync(join(dir, 'other.txt'), 'nothing here')

  const result = await workspaceSearch({ workspacePath: dir, pattern: 'hello' })
  assert.ok(result.ok)
  assert.equal(result.matches.length, 1)
  assert.ok(result.matches[0].path.endsWith('hello.txt'))

  cleanDir(dir)
})

test('workspaceSearch with regex', async () => {
  const dir = testDir('search-regex')
  writeFileSync(join(dir, 'data.txt'), 'error 42\ninfo line\nError 99')

  const result = await workspaceSearch({ workspacePath: dir, pattern: '[Ee]rror', regex: true })
  assert.ok(result.ok)
  assert.equal(result.matches.length, 2)

  cleanDir(dir)
})

test('workspaceAppend adds content to existing file', async () => {
  const dir = testDir('append')
  await workspaceWrite({ workspacePath: dir, path: 'log.txt', content: 'line1\n' })
  await workspaceWrite({ workspacePath: dir, path: 'log.txt', content: 'line2\n', append: true })

  const read = await workspaceRead({ workspacePath: dir, path: 'log.txt' })
  assert.equal(read.content, 'line1\nline2\n')

  cleanDir(dir)
})

test('workspaceGlobSearch with path subdirectory', async () => {
  const dir = testDir('glob-sub')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'root.txt'), '')
  writeFileSync(join(dir, 'sub', 'nested.txt'), '')

  const result = await workspaceGlobSearch({ workspacePath: dir, pattern: '**/nested.txt' })
  assert.ok(result.ok)
  assert.equal(result.matches.length, 1)

  cleanDir(dir)
})

test('workspaceDelete rejects non-recursive directory delete', async () => {
  const dir = testDir('no-recursive')
  mkdirSync(join(dir, 'subdir'), { recursive: true })
  writeFileSync(join(dir, 'subdir', 'inner.txt'), '')

  const result = await workspaceDelete({ workspacePath: dir, path: 'subdir' })
  assert.ok(!result.ok)
  assert.ok(result.error!.includes('recursive'))

  cleanDir(dir)
})

test('workspaceDelete recursive directory', async () => {
  const dir = testDir('recursive-del')
  mkdirSync(join(dir, 'subdir'), { recursive: true })
  writeFileSync(join(dir, 'subdir', 'inner.txt'), 'data')

  const result = await workspaceDelete({ workspacePath: dir, path: 'subdir', recursive: true })
  assert.ok(result.ok)

  cleanDir(dir)
})
