type JsonObject = Record<string, unknown>

import { asRecord, DEFAULT_TIMEOUT_MS } from '@kosmos/shared'

interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: JsonObject
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string }
}
export class MCPClient {
  private requestId = 0
  private readonly serverUrl: string
  private readonly agentName: string

  constructor(options?: { serverUrl?: string; agentName?: string }) {
    this.serverUrl = String(options?.serverUrl || 'http://localhost:18792')
    this.agentName = String(options?.agentName || 'agent')
  }

  private readonly requestTimeoutMs = 60000

  async callTool(tool: string, args: JsonObject = {}): Promise<unknown> {
    const id = ++this.requestId
    const params = tool === 'heartbeat_agent'
      ? asRecord(args)
      : { ...args, _agent: this.agentName }
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method: tool,
      params,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(`${this.serverUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.statusText}`)
      }

      const data: MCPResponse = await response.json()

      if (data.error) {
        throw new Error(`MCP error: ${data.error.message}`)
      }

      return data.result
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async listProjects() {
    return this.callTool('list_projects')
  }

  async getTasks(projectId: string, status?: string) {
    return this.callTool('get_tasks', { project_id: projectId, status })
  }

  async getTask(taskId: string) {
    return this.callTool('get_task', { id: taskId })
  }

  async moveTask(taskId: string, toStatus: string, agentName?: string, commentText?: string) {
    return this.callTool('move_task', { id: taskId, to_status: toStatus, agent_name: agentName, comment_text: commentText })
  }

  async rejectTask(taskId: string, reason: string) {
    return this.callTool('reject_task', { id: taskId, reason })
  }

  async getComments(taskId: string) {
    return this.callTool('get_comments', { task_id: taskId })
  }

  async addComment(taskId: string, comment: string, agentName?: string) {
    return this.callTool('add_comment', { task_id: taskId, comment, agent_name: agentName })
  }

  async getActiveAgents() {
    return this.callTool('get_active_agents')
  }

  async spawnAgent(profileId: string) {
    return this.callTool('spawn_agent', { profile_id: profileId })
  }

  async heartbeatAgent(pid: number, message?: string) {
    return this.callTool('heartbeat_agent', { pid, message })
  }

  async gitInit(path: string) {
    return this.callTool('git_init', { path })
  }

  async gitCreateWorktree(path: string, branchName: string, taskId: string) {
    return this.callTool('git_create_worktree', { path, branch_name: branchName, task_id: taskId })
  }

  async gitListWorktreeArtifacts(params: {
    worktreePath: string
    repoPath?: string
    baseBranch?: string
    workBranch?: string
  }) {
    return this.callTool('git_list_worktree_artifacts', {
      worktree_path: params.worktreePath,
      repo_path: params.repoPath,
      base_branch: params.baseBranch,
      work_branch: params.workBranch,
    })
  }

  async getConfig() {
    return this.callTool('get_config')
  }

  async runFrontendQaEvidence(workspacePath: string, taskId: string) {
    return this.callTool('run_frontend_qa_evidence', {
      workspace_path: workspacePath,
      task_id: taskId,
    })
  }

  async getQaEvidence(taskId: string) {
    return this.callTool('get_qa_evidence', {
      task_id: taskId,
    })
  }

  async getProjectAgentsMd(projectId: string) {
    return this.callTool('get_project_agents_md', {
      project_id: projectId,
    })
  }

  async touchTask(taskId: string, agentName?: string) {
    return this.callTool('touch_task', {
      task_id: taskId,
      agent_name: agentName,
    })
  }

  async workspaceExec(workspacePath: string, command: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this.callTool('workspace_exec', {
      workspace_path: workspacePath,
      command,
      timeout_ms: timeoutMs,
    })
  }

  async workspaceList(workspacePath: string, path = '.', recursive = false, limit = 200) {
    return this.callTool('workspace_list', {
      workspace_path: workspacePath,
      path,
      recursive,
      limit,
    })
  }

  async workspaceRead(workspacePath: string, path: string, offset = 1, limit = 400) {
    return this.callTool('workspace_read', {
      workspace_path: workspacePath,
      path,
      offset,
      limit,
    })
  }

  async workspaceWrite(workspacePath: string, path: string, content: string, append = false) {
    return this.callTool('workspace_write', {
      workspace_path: workspacePath,
      path,
      content,
      append,
    })
  }

  async workspaceEdit(workspacePath: string, params: {
    path: string
    find: string
    replace: string
    all?: boolean
    regex?: boolean
    ignore_case?: boolean
  }) {
    return this.callTool('workspace_edit', {
      workspace_path: workspacePath,
      ...params,
    })
  }

  async workspaceMove(workspacePath: string, from: string, to: string) {
    return this.callTool('workspace_move', {
      workspace_path: workspacePath,
      from,
      to,
    })
  }

  async workspaceDelete(workspacePath: string, path: string, recursive = false) {
    return this.callTool('workspace_delete', {
      workspace_path: workspacePath,
      path,
      recursive,
    })
  }

  async workspaceGlob(workspacePath: string, pattern: string, path = '.', limit = 200) {
    return this.callTool('workspace_glob', {
      workspace_path: workspacePath,
      pattern,
      path,
      limit,
    })
  }

  async workspaceSearch(workspacePath: string, params: {
    pattern: string
    path?: string
    include?: string
    limit?: number
    regex?: boolean
    ignore_case?: boolean
  }) {
    return this.callTool('workspace_search', {
      workspace_path: workspacePath,
      ...params,
    })
  }
}
