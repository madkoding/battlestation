import { z } from 'zod'

export const mcpTools = {
  list_projects: {
    description: 'List all projects',
    inputSchema: {},
    outputSchema: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
  },

  create_project: {
    description: 'Create a new project',
    inputSchema: {
      name: { type: 'string', description: 'Project name' },
      path: { type: 'string', description: 'Path to the project directory' },
      color: { type: 'string', optional: true, description: 'Project color' },
      description: { type: 'string', optional: true },
    },
    outputSchema: z.object({ id: z.string(), name: z.string(), path: z.string() }),
  },

  get_project: {
    description: 'Get a project by ID',
    inputSchema: { id: { type: 'string' } },
    outputSchema: z.object({ id: z.string(), name: z.string(), path: z.string() }),
  },

  delete_project: {
    description: 'Delete a project',
    inputSchema: { id: { type: 'string' } },
    outputSchema: z.object({ success: z.boolean() }),
  },

  get_tasks: {
    description: 'Get tasks for a project',
    inputSchema: {
      project_id: { type: 'string' },
      status: { type: 'string', optional: true, description: 'Filter by status: todo, progress, qa, done' },
    },
    outputSchema: z.array(z.object({ id: z.string(), title: z.string(), status: z.string() })),
  },

  get_task: {
    description: 'Get a task by ID with full context',
    inputSchema: { id: { type: 'string' } },
    outputSchema: z.object({ id: z.string(), title: z.string(), status: z.string() }),
  },

  create_task: {
    description: 'Create a new task',
    inputSchema: {
      project_id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string', optional: true },
      priority: { type: 'string', optional: true, description: 'low, medium, high' },
    },
    outputSchema: z.object({ id: z.string(), title: z.string(), status: z.string() }),
  },

  move_task: {
    description: 'Move a task to a new status',
    inputSchema: {
      id: { type: 'string' },
      to_status: { type: 'string', description: 'todo, progress, qa, done' },
      agent_name: { type: 'string', optional: true },
      comment_text: { type: 'string', optional: true },
    },
    outputSchema: z.object({ id: z.string(), title: z.string(), status: z.string() }),
  },

  reject_task: {
    description: 'Reject a task during QA and send back to progress',
    inputSchema: {
      id: { type: 'string' },
      reason: { type: 'string' },
    },
    outputSchema: z.object({ id: z.string(), title: z.string(), status: z.string() }),
  },

  get_comments: {
    description: 'Get comments for a task',
    inputSchema: { task_id: { type: 'string' } },
    outputSchema: z.array(z.object({ id: z.string(), comment: z.string(), created_at: z.string() })),
  },

  add_comment: {
    description: 'Add a comment to a task',
    inputSchema: {
      task_id: { type: 'string' },
      comment: { type: 'string' },
      agent_name: { type: 'string', optional: true },
    },
    outputSchema: z.object({ id: z.string(), comment: z.string(), created_at: z.string() }),
  },

  list_agents: {
    description: 'List available agent profiles',
    inputSchema: {},
    outputSchema: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
  },

  spawn_agent: {
    description: 'Spawn a new agent process',
    inputSchema: { profile_id: { type: 'string' } },
    outputSchema: z.object({ pid: z.number(), profile_id: z.string(), started_at: z.string() }),
  },

  kill_agent: {
    description: 'Kill a running agent process',
    inputSchema: { pid: { type: 'number' } },
    outputSchema: z.object({ success: z.boolean() }),
  },

  get_active_agents: {
    description: 'Get list of active (running) agents',
    inputSchema: {},
    outputSchema: z.array(z.object({ pid: z.number(), profile_id: z.string(), started_at: z.string() })),
  },

  get_config: {
    description: 'Get current configuration (without secrets)',
    inputSchema: {},
    outputSchema: z.object({ mode: z.string(), database: z.object({ url: z.string() }) }),
  },

  update_config: {
    description: 'Update configuration',
    inputSchema: {
      partial: { type: 'object', description: 'Partial config object' },
    },
    outputSchema: z.object({ mode: z.string() }),
  },

  unlock_config: {
    description: 'Unlock configuration with password to access encrypted values',
    inputSchema: { password: { type: 'string' } },
    outputSchema: z.object({ unlocked: z.boolean() }),
  },

  git_init: {
    description: 'Initialize a git repository if not already initialized',
    inputSchema: { path: { type: 'string' } },
    outputSchema: z.object({ success: z.boolean(), base_branch: z.string() }),
  },

  git_create_worktree: {
    description: 'Create a git worktree for a task',
    inputSchema: {
      path: { type: 'string' },
      branch_name: { type: 'string' },
      task_id: { type: 'string' },
    },
    outputSchema: z.object({ success: z.boolean(), worktree_path: z.string() }),
  },

  git_merge_worktree: {
    description: 'Merge a worktree branch back to base branch',
    inputSchema: {
      branch_name: { type: 'string' },
      task_id: { type: 'string' },
    },
    outputSchema: z.object({ success: z.boolean(), commit_hash: z.string() }),
  },

  git_delete_worktree: {
    description: 'Delete a worktree after merge',
    inputSchema: { branch_name: { type: 'string' } },
    outputSchema: z.object({ success: z.boolean() }),
  },

  run_playwright: {
    description: 'Run Playwright screenshots with optional QA evidence persistence',
    inputSchema: {
      workspace_path: { type: 'string', description: 'Workspace or worktree path' },
      task_id: { type: 'string', optional: true, description: 'If provided, persists result into qa_evidence' },
      base_url: { type: 'string', optional: true, description: 'Direct URL to capture (skips dev server discovery)' },
      urls: { type: 'array', optional: true, description: 'Optional list of URLs to capture directly' },
      script: { type: 'string', optional: true, description: 'Optional npm script to start frontend dev server' },
      output_subdir: { type: 'string', optional: true, description: 'Optional workspace-relative output path' },
      max_urls: { type: 'number', optional: true, description: 'Limit of URLs to capture' },
    },
    outputSchema: z.object({
      executed: z.boolean(),
      persisted: z.boolean(),
      task_id: z.string().optional(),
      reason: z.string().optional(),
      script: z.string().optional(),
      command: z.string().optional(),
      base_url: z.string().optional(),
      screenshots: z.array(z.object({
        path: z.string(),
        url: z.string(),
        viewport: z.enum(['desktop', 'mobile']),
      })),
      logs: z.array(z.string()),
    }),
  },

  get_project_agents_md: {
    description: 'Get AGENTS.md instructions for a project context',
    inputSchema: {
      project_id: { type: 'string' },
    },
    outputSchema: z.object({
      project_id: z.string(),
      path: z.string(),
      content: z.string(),
      exists: z.boolean(),
    }),
  },
} as const

export type MCPTools = typeof mcpTools
