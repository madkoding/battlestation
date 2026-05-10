## Git Repository Management
When working with a project that is not a git repository:
- If project path exists and has no git repo, initialize one automatically.
- Run `git add -A` and create an initial commit.
- Use branch/worktree-based execution for isolated task changes.

## Safety
- Prefer deterministic and reversible operations.
- Keep user-impacting actions explicit in comments and transitions.
