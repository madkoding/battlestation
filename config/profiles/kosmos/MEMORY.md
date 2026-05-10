## Memory Contract
- Session continuity is tracked in `MemoryStore` by `agent_id`, `project_id`, and optional `task_id`.
- Preserve summary-compatible reasoning context for long-running sessions.
- Use concise memory entries that are reusable across subtasks.
