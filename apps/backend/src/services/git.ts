import { execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

interface ExecError {
  stderr?: string
  message?: string
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim()
  } catch (error) {
    const execError = error as ExecError
    throw new Error(`Git error: ${execError.stderr || execError.message || 'unknown error'}`)
  }
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function branchExists(path: string, branchName: string): boolean {
  try {
    exec(`git -C "${path}" rev-parse --verify --quiet "refs/heads/${branchName}"`)
    return true
  } catch {
    return false
  }
}

function getCurrentBranch(path: string): string {
  try {
    return exec(`git -C "${path}" branch --show-current`)
  } catch {
    return 'main'
  }
}

export function gitInit(path: string): { success: boolean; base_branch: string } {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }

  if (isGitRepo(path)) {
    return { success: true, base_branch: getCurrentBranch(path) }
  }

  exec(`git -C "${path}" init`)

  const readmePath = join(path, 'README.md')
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, `# ${path.split('/').pop()}\n`)
    exec(`git -C "${path}" add .`)
    try {
      exec(`git -C "${path}" commit -m "Initial commit"`)
    } catch {
      // Empty repo
    }
  }

  try {
    exec(`git -C "${path}" checkout -b main`)
  } catch {
    // Branch might exist
  }

  return { success: true, base_branch: 'main' }
}

export function gitCreateWorktree(
  path: string,
  branchName: string,
  taskId: string
): { success: boolean; worktree_path: string } {
  void taskId
  if (!isGitRepo(path)) {
    gitInit(path)
  }

  const worktreeDir = join(path, '.worktrees')
  if (!existsSync(worktreeDir)) {
    mkdirSync(worktreeDir, { recursive: true })
  }

  const worktreePath = join(worktreeDir, branchName)

  if (branchExists(path, branchName)) {
    return { success: true, worktree_path: worktreePath }
  }

  try {
    exec(`git -C "${path}" worktree add "${worktreePath}" -b "${branchName}"`)
  } catch (error) {
    const execError = error as ExecError
    const message = String(execError.message || '')
    if (
      message.includes('already exists') ||
      message.includes('worktree exists') ||
      message.includes('a branch named')
    ) {
      return { success: true, worktree_path: worktreePath }
    }
    throw error
  }

  return { success: true, worktree_path: worktreePath }
}

export function gitMergeWorktree(
  branchName: string,
  taskId: string
): { success: boolean; commit_hash: string } {
  void taskId
  return {
    success: true,
    commit_hash: `mock-commit-${branchName}`,
  }
}

export function gitDeleteWorktree(branchName: string): { success: boolean } {
  void branchName
  return { success: true }
}

export function gitListWorktreeArtifacts(params: {
  worktreePath: string
  repoPath?: string
  baseBranch?: string
  workBranch?: string
}): {
  exists: boolean
  changed_files: string[]
  recent_commits: string[]
  files_between_branches: string[]
} {
  const { worktreePath, repoPath, baseBranch, workBranch } = params

  if (!existsSync(worktreePath)) {
    return {
      exists: false,
      changed_files: [],
      recent_commits: [],
      files_between_branches: [],
    }
  }

  try {
    const statusRaw = exec(`git -C "${worktreePath}" status --porcelain`)
    const changedFiles = statusRaw
      ? statusRaw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^([A-Z?]{1,2})\s+/, '').trim())
          .filter(Boolean)
      : []

    const commitsRaw = exec(`git -C "${worktreePath}" log --oneline -n 5`)
    const recentCommits = commitsRaw
      ? commitsRaw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : []

    let filesBetweenBranches: string[] = []
    const repo = String(repoPath || '').trim()
    const base = String(baseBranch || '').trim()
    const branch = String(workBranch || '').trim()
    if (repo && base && branch && existsSync(repo)) {
      try {
        const diffRaw = exec(`git -C "${repo}" diff --name-only "${base}...${branch}"`)
        filesBetweenBranches = diffRaw
          ? diffRaw.split('\n').map((line) => line.trim()).filter(Boolean)
          : []
      } catch {
        filesBetweenBranches = []
      }
    }

    return {
      exists: true,
      changed_files: changedFiles,
      recent_commits: recentCommits,
      files_between_branches: filesBetweenBranches,
    }
  } catch {
    return {
      exists: true,
      changed_files: [],
      recent_commits: [],
      files_between_branches: [],
    }
  }
}
