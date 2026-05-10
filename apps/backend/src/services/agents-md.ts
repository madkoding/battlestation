import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

const AGENTS_FILE_NAME = 'AGENTS.md'
const DEFAULT_PROMPT_MAX_CHARS = 12000

export interface ProjectAgentsDocument {
  project_id: string
  path: string
  content: string
  exists: boolean
}

function buildDefaultAgentsContent(params: {
  projectName: string
  projectPath: string
}): string {
  const { projectName, projectPath } = params
  const safeName = String(projectName || 'Project').trim() || 'Project'
  const safePath = String(projectPath || '').trim() || '.'

  return [
    `# ${safeName} - Agent Instructions`,
    '',
    '## Project Overview',
    `- Repository path: ${safePath}`,
    '- Core objective: describe the main product objective and user value.',
    '',
    '## Architecture Notes',
    '- List key modules and ownership boundaries.',
    '- Add critical runtime constraints (ports, services, external dependencies).',
    '',
    '## Coding Standards',
    '- Keep changes focused and avoid unrelated refactors.',
    '- Prefer deterministic tests and explicit validation evidence.',
    '',
    '## QA and Validation',
    '- Define mandatory checks for feature completion.',
    '- Include expected evidence format for QA handoff.',
    '',
    '## Delivery Guardrails',
    '- Call out prohibited operations and high-risk actions.',
    '- Document escalation rules for blocked tasks.',
  ].join('\n')
}

function resolveAgentsFilePath(projectPath: string): string {
  const root = resolve(String(projectPath || '').trim())
  return join(root, AGENTS_FILE_NAME)
}

function ensureProjectDirectory(projectPath: string) {
  const root = resolve(String(projectPath || '').trim())
  if (!root || !existsSync(root)) {
    throw new Error('Project path does not exist')
  }
  const stats = statSync(root)
  if (!stats.isDirectory()) {
    throw new Error('Project path must be a directory')
  }
  return root
}

export function readProjectAgentsMd(params: {
  projectId: string
  projectName: string
  projectPath: string
}): ProjectAgentsDocument {
  const projectId = String(params.projectId || '').trim()
  const projectName = String(params.projectName || '').trim()
  const projectPath = String(params.projectPath || '').trim()

  if (!projectPath || !existsSync(projectPath)) {
    return {
      project_id: projectId,
      path: AGENTS_FILE_NAME,
      content: buildDefaultAgentsContent({ projectName, projectPath }),
      exists: false,
    }
  }

  const agentsPath = resolveAgentsFilePath(projectPath)
  if (!existsSync(agentsPath)) {
    return {
      project_id: projectId,
      path: agentsPath,
      content: buildDefaultAgentsContent({ projectName, projectPath }),
      exists: false,
    }
  }

  return {
    project_id: projectId,
    path: agentsPath,
    content: readFileSync(agentsPath, 'utf-8'),
    exists: true,
  }
}

export function writeProjectAgentsMd(params: {
  projectId: string
  projectName: string
  projectPath: string
  content: string
}): ProjectAgentsDocument {
  const projectRoot = ensureProjectDirectory(params.projectPath)
  const agentsPath = resolveAgentsFilePath(projectRoot)
  mkdirSync(dirname(agentsPath), { recursive: true })

  const incoming = String(params.content || '').trim()
  const content = incoming || buildDefaultAgentsContent({
    projectName: String(params.projectName || '').trim(),
    projectPath: projectRoot,
  })

  writeFileSync(agentsPath, `${content}\n`, 'utf-8')

  return {
    project_id: String(params.projectId || '').trim(),
    path: agentsPath,
    content,
    exists: true,
  }
}

export function compactAgentsInstructionsForPrompt(content: string, maxChars = DEFAULT_PROMPT_MAX_CHARS): string {
  const normalized = String(content || '').trim()
  if (!normalized) return ''

  const safeMax = Math.max(500, Number(maxChars || DEFAULT_PROMPT_MAX_CHARS))
  if (normalized.length <= safeMax) {
    return normalized
  }

  const head = normalized.slice(0, Math.floor(safeMax * 0.7)).trimEnd()
  const tail = normalized.slice(-Math.floor(safeMax * 0.2)).trimStart()

  return `${head}\n\n[project instructions compacted]\n\n${tail}`
}
