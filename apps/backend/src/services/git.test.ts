import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import {
  gitInit,
  gitCreateWorktree,
  gitMergeWorktree,
  gitDeleteWorktree,
  gitListWorktreeArtifacts,
} from './git'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
}

function makeTempRepo(name: string): string {
  const dir = `/tmp/git-test-${name}-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`)
  execSync('git init', { cwd: dir, encoding: 'utf-8' })
  execSync('git config user.name test && git config user.email test@test.com', { cwd: dir, encoding: 'utf-8' })
  execSync('git add . && git commit -m "initial"', { cwd: dir, encoding: 'utf-8', env: GIT_ENV })
  return dir
}

function cleanDir(dir: string): void {
  if (dir.startsWith('/tmp/') && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('gitInit returns success for existing repo', () => {
  const dir = makeTempRepo('init-existing')
  try {
    const result = gitInit(dir)
    assert.ok(result.success)
    assert.ok(result.base_branch.length > 0)
  } finally {
    cleanDir(dir)
  }
})

test('gitInit creates repo in empty dir', () => {
  const dir = `/tmp/git-test-init-new-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  try {
    const result = gitInit(dir)
    assert.ok(result.success)
    assert.ok(existsSync(join(dir, '.git')))
  } finally {
    cleanDir(dir)
  }
})

test('gitCreateWorktree creates worktree', () => {
  const dir = makeTempRepo('worktree')
  try {
    const result = gitCreateWorktree(dir, 'feature/test', 'task-1234')
    assert.ok(result.success)
    assert.ok(result.worktree_path.includes('.worktrees'))
    assert.ok(existsSync(result.worktree_path))
  } finally {
    cleanDir(dir)
  }
})

test('gitCreateWorktree returns existing worktree without error', () => {
  const dir = makeTempRepo('worktree-existing')
  try {
    gitCreateWorktree(dir, 'feature/test2', 'task-1234')
    const result = gitCreateWorktree(dir, 'feature/test2', 'task-1234')
    assert.ok(result.success)
  } finally {
    cleanDir(dir)
  }
})

test('gitListWorktreeArtifacts returns changed files', () => {
  const dir = makeTempRepo('artifacts')
  const branchName = 'feature/artifacts'
  try {
    gitCreateWorktree(dir, branchName, 'task-5678')
    const wtPath = join(dir, '.worktrees', branchName)
    writeFileSync(join(wtPath, 'new-file.txt'), 'content')

    const result = gitListWorktreeArtifacts({
      worktreePath: wtPath,
      repoPath: dir,
      baseBranch: 'main',
      workBranch: branchName,
    })
    assert.ok(result.exists)
    assert.ok(result.changed_files.length >= 1)
    assert.ok(result.changed_files.some((f) => f.endsWith('new-file.txt')))
  } finally {
    cleanDir(dir)
  }
})

test('gitListWorktreeArtifacts returns exists=false for missing path', () => {
  const result = gitListWorktreeArtifacts({ worktreePath: '/tmp/nonexistent-worktree-ghost' })
  assert.ok(!result.exists)
  assert.deepEqual(result.changed_files, [])
  assert.deepEqual(result.recent_commits, [])
})

test('gitMergeWorktree squash merges branch', () => {
  const dir = makeTempRepo('merge')
  const branchName = 'feature/merge-test'
  try {
    gitCreateWorktree(dir, branchName, 'task-9012')
    const wtPath = join(dir, '.worktrees', branchName)
    writeFileSync(join(wtPath, 'merge-file.txt'), 'merged content')
    execSync('git add . && git commit -m "add merge file"', { cwd: wtPath, encoding: 'utf-8' })

    const result = gitMergeWorktree(dir, branchName, 'task-9012')
    assert.ok(result.success)
    assert.ok(result.commit_hash.length > 0)
  } finally {
    cleanDir(dir)
  }
})

test('gitDeleteWorktree removes branch and worktree dir', () => {
  const dir = makeTempRepo('delete')
  const branchName = 'feature/delete-test'
  try {
    gitCreateWorktree(dir, branchName, 'task-3456')
    const wtPath = join(dir, '.worktrees', branchName)
    assert.ok(existsSync(wtPath))

    const result = gitDeleteWorktree(dir, branchName)
    assert.ok(result.success)
  } finally {
    cleanDir(dir)
  }
})

test('gitDeleteWorktree handles non-existent branch gracefully', () => {
  const dir = makeTempRepo('delete-nonexist')
  try {
    const result = gitDeleteWorktree(dir, 'feature/ghost-branch')
    assert.ok(result.success)
  } finally {
    cleanDir(dir)
  }
})
