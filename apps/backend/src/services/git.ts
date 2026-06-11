import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

function git(args: string[], cwd?: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
  })
  if (result.error) throw new Error(`Git error: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Git error: ${result.stderr?.trim() || result.stdout?.trim() || 'unknown error'}`)
  return result.stdout.trim()
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function branchExists(path: string, branchName: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], path)
    return true
  } catch {
    return false
  }
}

function getCurrentBranch(path: string): string {
  try {
    return git(['branch', '--show-current'], path)
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

  git(['init'], path)

  const readmePath = join(path, 'README.md')
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, `# ${path.split('/').pop()}\n`)
    git(['add', '.'], path)
    try {
      git(['commit', '-m', 'Initial commit'], path)
    } catch {
      // Empty repo
    }
  }

  try {
    git(['checkout', '-b', 'main'], path)
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
    git(['worktree', 'add', worktreePath, '-b', branchName], path)
  } catch (error: unknown) {
    const message = String(error instanceof Error ? error.message : '')
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
  repoPath: string,
  branchName: string,
  taskId: string
): { success: boolean; commit_hash: string } {
  try {
    const currentBranch = getCurrentBranch(repoPath)
    const baseBranch = currentBranch !== branchName ? currentBranch : 'main'

    git(['checkout', baseBranch], repoPath)
    git(['merge', '--squash', branchName], repoPath)
    const message = `Merge task/${taskId.slice(0, 8)}: completed`
    git(['commit', '-m', message], repoPath)
    const commitHash = git(['rev-parse', 'HEAD'], repoPath)

    return { success: true, commit_hash: commitHash }
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Git merge error: ${err}`)
  }
}

export function gitDeleteWorktree(path: string, branchName: string): { success: boolean } {
  try {
    const worktreePath = join(path, '.worktrees', branchName)
    if (existsSync(worktreePath)) {
      try {
        git(['worktree', 'remove', worktreePath], path)
      } catch {
        rmSync(worktreePath, { recursive: true, force: true })
        git(['worktree', 'prune'], path)
      }
    }
    if (branchExists(path, branchName)) {
      git(['branch', '-D', branchName], path)
    }
    return { success: true }
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : 'unknown error'
    console.error(`[git] Delete worktree error: ${err}`)
    return { success: false }
  }
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
    const statusRaw = git(['status', '--porcelain'], worktreePath)
    const changedFiles = statusRaw
      ? statusRaw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^([A-Z?]{1,2})\s+/, '').trim())
          .filter(Boolean)
      : []

    const commitsRaw = git(['log', '--oneline', '-n', '5'], worktreePath)
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
        const diffRaw = git(['diff', '--name-only', `${base}...${branch}`], repo)
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
