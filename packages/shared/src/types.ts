import { z } from 'zod'

export const TaskStatusSchema = z.enum(['todo', 'progress', 'qa', 'done'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const PrioritySchema = z.enum(['low', 'medium', 'high'])
export type Priority = z.infer<typeof PrioritySchema>

export const LLMProviderSchema = z.enum(['ollama', 'openai', 'anthropic', 'google'])
export type LLMProvider = z.infer<typeof LLMProviderSchema>

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  color: z.string().optional(),
  description: z.string().optional(),
  banner_image_url: z.string().optional(),
  is_hidden: z.boolean().default(false),
  task_count: z.number().default(0),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Project = z.infer<typeof ProjectSchema>

export const CreateProjectInputSchema = z.object({
  name: z.string(),
  path: z.string(),
  color: z.string().optional(),
  description: z.string().optional(),
  banner_image_url: z.string().optional(),
})
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>

export const TaskSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: TaskStatusSchema,
  assigned_to: z.string().optional(),
  priority: PrioritySchema.default('medium'),
  task_kind: z.enum(['task', 'subtask']).default('task'),
  parent_task_id: z.string().optional(),
  workspace_path: z.string().optional(),
  work_branch: z.string().optional(),
  base_branch: z.string().optional(),
  release_approved: z.boolean().default(false),
  approved_by: z.string().optional(),
  approved_branch: z.string().optional(),
  approved_push: z.boolean().default(false),
  approved_at: z.string().optional(),
  jira_ready: z.boolean().default(false),
  stage_notified_stage: z.string().optional(),
  stage_notified_at: z.string().optional(),
  release_ready_notified_at: z.string().optional(),
  retry_count: z.number().optional(),
  last_failure_reason: z.string().optional(),
  escalation_count: z.number().optional(),
  requeue_count: z.number().optional(),
  last_escalated_at: z.string().optional(),
  last_requeued_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  subtask_count: z.number().optional(),
  completed_subtasks: z.number().optional(),
})
export type Task = z.infer<typeof TaskSchema>

export const CreateTaskInputSchema = z.object({
  project_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  parent_task_id: z.string().optional(),
})
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>

export const UpdateTaskInputSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  assigned_to: z.string().optional(),
})
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>

export const MoveTaskInputSchema = z.object({
  to_status: TaskStatusSchema,
  agent_name: z.string().optional(),
  comment_text: z.string().optional(),
})
export type MoveTaskInput = z.infer<typeof MoveTaskInputSchema>

export const RejectTaskInputSchema = z.object({
  reason: z.string(),
})
export type RejectTaskInput = z.infer<typeof RejectTaskInputSchema>

export const TaskCommentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  agent_id: z.string().optional(),
  agent_name: z.string().optional(),
  comment: z.string(),
  created_at: z.string(),
})
export type TaskComment = z.infer<typeof TaskCommentSchema>

export const CreateCommentInputSchema = z.object({
  comment: z.string(),
  agent_name: z.string().optional(),
})
export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>

export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
})
export type AgentProfile = z.infer<typeof AgentProfileSchema>

export interface RunningAgent {
  pid: number
  profile_id: string
  started_at: string
}

export const LLMProviderConfigSchema = z.object({
  provider: LLMProviderSchema,
  base_url: z.string().optional(),
  api_key: z.string().optional(),
  model: z.string(),
  temperature: z.number().default(0.2),
  top_p: z.number().default(0.9),
  max_tokens: z.number().default(16384),
})
export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>

export const ConfigSchema = z.object({
  mode: z.enum(['local', 'remote']).default('local'),
  database: z.object({
    url: z.string(),
  }),
  llm: z.object({
    providers: z.record(LLMProviderSchema, z.object({
      base_url: z.string().optional(),
      api_key: z.string().optional(),
    })),
    default_provider: LLMProviderSchema,
  }),
  agents: z.record(z.string(), LLMProviderConfigSchema),
  server: z.object({
    port: z.number().default(18792),
    cors_origins: z.array(z.string()).default(['*']),
  }),
})
export type Config = z.infer<typeof ConfigSchema>

export const ActivitySchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  agent: z.string(),
  agent_id: z.string().optional(),
  agent_name: z.string().optional(),
  message: z.string(),
  current_task: z.string().optional(),
  task_id: z.string().optional(),
  task_title: z.string().optional(),
  project_id: z.string().optional(),
  project_name: z.string().optional(),
  status: z.string().optional(),
  mood: z.string().optional(),
  timestamp: z.string(),
  metadata: z.record(z.unknown()).optional(),
})
export type Activity = z.infer<typeof ActivitySchema>

export const IdParamSchema = z.object({ id: z.string() })
export const PidParamSchema = z.object({ pid: z.string() })
export const EvidenceScreenshotParamsSchema = z.object({
  id: z.string(),
  evidenceId: z.string(),
  index: z.string(),
})

export const UpdateProjectInputSchema = z.object({
  name: z.string().optional(),
  path: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
})

export const ProjectTasksQuerySchema = z.object({
  project_id: z.string().optional(),
  status: TaskStatusSchema.optional(),
  include_subtasks: z.union([z.literal('0'), z.literal('1')]).optional(),
})

export const TaskContextQuerySchema = z.object({
  include_comments: z.union([z.literal('0'), z.literal('1')]).optional(),
})

export const CommentsQuerySchema = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

export const SpawnAgentBodySchema = z.object({
  profile_id: z.string(),
})

export const ApproveQaBodySchema = z.object({
  approved_by: z.string().optional(),
})

export const AddCommentBodySchema = z.object({
  comment: z.string(),
  agent_name: z.string().optional(),
})

export const AgentsMdBodySchema = z.object({
  content: z.string().optional(),
})

export const UpdateConfigBodySchema = z.object({
  partial: z.record(z.unknown()),
})

export const LiveActivityQuerySchema = z.object({
  project_id: z.string().optional(),
  task_id: z.string().optional(),
})

export const TransitionTaskBodySchema = MoveTaskInputSchema.extend({
  qa_checklist: z.object({
    scope_complete: z.boolean().optional(),
    self_review_done: z.boolean().optional(),
    tests_passed: z.boolean().optional(),
    diff_attached: z.boolean().optional(),
  }).optional(),
  qa_rejection: z.object({
    root_cause: z.string().optional(),
    repro_steps: z.string().optional(),
    impacted_files: z.string().optional(),
    failed_checks: z.array(z.string()).optional(),
  }).optional(),
})
export type TransitionTaskInput = z.infer<typeof TransitionTaskBodySchema>

export const ApproveQaInputSchema = z.object({
  approved_by: z.string(),
  branch: z.string(),
  push: z.boolean(),
})
export type ApproveQaInput = z.infer<typeof ApproveQaInputSchema>

export interface TaskContext {
  task: Task
  project: Project
  comments: TaskComment[]
  subtasks: Task[]
  children_by_status: Record<string, number>
}

export const WSMessageSchema = z.union([
  z.object({ type: z.literal('task:updated'), payload: z.object({ task_id: z.string(), project_id: z.string() }) }),
  z.object({ type: z.literal('task:created'), payload: z.object({ task_id: z.string(), project_id: z.string() }) }),
  z.object({ type: z.literal('task:comment_created'), payload: z.object({ task_id: z.string(), project_id: z.string() }) }),
  z.object({ type: z.literal('task:deleted'), payload: z.object({ project_id: z.string() }) }),
  z.object({ type: z.literal('activity'), payload: ActivitySchema }),
  z.object({ type: z.literal('project_status'), payload: z.array(ProjectSchema) }),
  z.object({ type: z.literal('qa:ready_for_approval'), payload: z.object({ task_id: z.string() }) }),
  z.object({
    type: z.literal('qa:approval_confirmed'),
    payload: z.object({
      task_id: z.string(),
      approved_by: z.string().optional(),
    }),
  }),
])
export type WSMessage = z.infer<typeof WSMessageSchema>
