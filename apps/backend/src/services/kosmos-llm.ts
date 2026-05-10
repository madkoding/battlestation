import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getConfig } from './config'
import { getRuntimePolicy } from './policy'
import { readProjectAgentsMd, compactAgentsInstructionsForPrompt } from './agents-md'

const __dirname = dirname(fileURLToPath(import.meta.url))

type JsonObject = Record<string, unknown>

interface LlmChatChoice {
  message?: {
    content?: string
  }
}

interface LlmChatResponse {
  choices?: LlmChatChoice[]
}

interface LlmGenerateResponse {
  response?: string
}

interface TaskSummary {
  id?: string
  priority?: string
  title?: string
  description?: string
}

interface ProjectSummary {
  id?: string
  name?: string
  path?: string
}

interface PlanNextTaskParams {
  project: ProjectSummary
  todoTasks: TaskSummary[]
  progressTasks: TaskSummary[]
  qaTasks: TaskSummary[]
  doneTasks: TaskSummary[]
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonObject
}

function loadKosmosSystemPrompt(): string {
  const backendSrcDir = join(__dirname, '..')
  const projectRoot = join(backendSrcDir, '..', '..')
  const baseDir = join(projectRoot, 'config', 'profiles', 'kosmos')
  const files = ['PROFILE.md', 'SOUL.md', 'WORKFLOW.md', 'STYLE.md', 'GUARDRAILS.md', 'POLICY.md']
  const sections: string[] = []
  for (const file of files) {
    const path = join(baseDir, file)
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf-8')
    sections.push(`# ${file.replace('.md', '')}\n${content}`)
  }
  return sections.join('\n\n')
}

async function callConfiguredLLM(prompt: string): Promise<string> {
  const config = await getConfig()
  const agentConfig = config.agents?.kosmos || {}
  const policyTuning = getRuntimePolicy('kosmos').settings.tuning_presets.balanced.kosmos
  const provider = String(config.llm?.default_provider || 'ollama')
  const providerConfig = config.llm?.providers?.[provider] || {}
  const model = String(providerConfig.model || 'minimax-m2.7')
  const baseUrl = String(providerConfig.base_url || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'))
  const apiKey = String(providerConfig.api_key || '')
  const isOllamaCloud = provider === 'ollama' && /ollama\.com|\/v1$/i.test(baseUrl)

  const endpoint = provider === 'ollama' && !isOllamaCloud
    ? `${baseUrl}/api/generate`
    : `${baseUrl}/chat/completions`
  const body = provider === 'ollama' && !isOllamaCloud
    ? {
        model,
        prompt,
        stream: false,
        options: {
          temperature: Number(agentConfig.temperature ?? policyTuning.temperature),
          top_p: Number(agentConfig.top_p ?? policyTuning.top_p),
          num_predict: 900,
        },
      }
    : {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: Number(agentConfig.temperature ?? policyTuning.temperature),
        max_tokens: Number(agentConfig.max_tokens ?? policyTuning.max_tokens),
      }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...((provider !== 'ollama' || isOllamaCloud) && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Kosmos LLM error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as LlmGenerateResponse | LlmChatResponse
  const text = provider === 'ollama' && !isOllamaCloud
    ? String((data as LlmGenerateResponse)?.response || '')
    : String((data as LlmChatResponse)?.choices?.[0]?.message?.content || '')
  return text.trim()
}

function parseJsonBlock(text: string): JsonObject | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] || raw
  try {
    return asObject(JSON.parse(candidate))
  } catch {
    const firstObj = candidate.match(/\{[\s\S]*\}/)
    if (!firstObj) return null
    try {
      return asObject(JSON.parse(firstObj[0]))
    } catch {
      return null
    }
  }
}

export async function planNextTaskWithKosmosLLM(params: PlanNextTaskParams): Promise<{ selectedTaskId: string | null; rationale: string }> {
  const { project, todoTasks, progressTasks, qaTasks, doneTasks } = params
  if (!todoTasks.length) {
    return { selectedTaskId: null, rationale: 'No todo tasks available' }
  }

  const systemPrompt = loadKosmosSystemPrompt()
  const projectInstructionsDocument = readProjectAgentsMd({
    projectId: String(project.id || ''),
    projectName: String(project.name || ''),
    projectPath: String(project.path || ''),
  })
  const projectInstructions = compactAgentsInstructionsForPrompt(projectInstructionsDocument.content, 8000)
  const prompt = `${systemPrompt}

You are orchestrating a software backlog. Select exactly ONE next TODO task that should move to progress.
Prioritize prerequisite-first execution and unblockability.

Project: ${project.name || project.id}

Project instructions:
${projectInstructions || 'None provided.'}

Current TODO tasks:
${todoTasks.map((t) => `- id=${t.id} | priority=${t.priority} | title=${t.title} | description=${t.description || 'n/a'}`).join('\n')}

Current PROGRESS tasks:
${progressTasks.map((t) => `- ${t.id}: ${t.title}`).join('\n') || '- none'}

Current QA tasks:
${qaTasks.map((t) => `- ${t.id}: ${t.title}`).join('\n') || '- none'}

Current DONE tasks:
${doneTasks.map((t) => `- ${t.id}: ${t.title}`).join('\n') || '- none'}

Return strict JSON only:
{
  "selected_task_id": "<task-id>",
  "rationale": "<brief reason>"
}

Policy context:
- priority order: ${(getRuntimePolicy('kosmos').orchestration.priority_order || ['high', 'medium', 'low']).join(' > ')}
`

  const output = await callConfiguredLLM(prompt)
  const parsed = parseJsonBlock(output)
  const selectedTaskId = String(parsed?.selected_task_id || '').trim()
  if (!selectedTaskId) {
    throw new Error('Kosmos LLM planning returned no selected_task_id')
  }
  const exists = todoTasks.some((task) => String(task.id) === selectedTaskId)
  if (!exists) {
    throw new Error('Kosmos LLM planning selected a task outside current TODO list')
  }
  return {
    selectedTaskId,
    rationale: String(parsed?.rationale || 'LLM-selected next task based on dependency sequencing'),
  }
}

export async function buildKosmosRefinementBrief(params: {
  task: TaskSummary
  project: ProjectSummary
}): Promise<string> {
  const { task, project } = params
  const systemPrompt = loadKosmosSystemPrompt()
  const projectInstructionsDocument = readProjectAgentsMd({
    projectId: String(project.id || ''),
    projectName: String(project.name || ''),
    projectPath: String(project.path || ''),
  })
  const projectInstructions = compactAgentsInstructionsForPrompt(projectInstructionsDocument.content, 8000)
  const prompt = `${systemPrompt}

Refine this task so a developer agent can execute it without ambiguity.

Project: ${project.name || project.id}
Task id: ${task.id}
Title: ${task.title}
Description: ${task.description || 'No description'}

Project instructions:
${projectInstructions || 'None provided.'}

Write markdown with this structure:
1) Objective
2) Scope In
3) Scope Out
4) Acceptance Criteria (checklist)
5) Validation Plan
6) Handoff Notes

Constraints:
- Be specific and implementation-ready.
- Do not invent repository files that are unknown.
- Keep under 300 words.
`

  const output = await callConfiguredLLM(prompt)
  const trimmed = String(output || '').trim()
  if (!trimmed) {
    throw new Error('Kosmos LLM refinement returned empty output')
  }
  return trimmed
}
