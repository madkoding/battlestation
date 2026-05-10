# Battlestation - AI Agent Orchestration Platform

## Overview

Battlestation is a multi-agent orchestration system that manages AI agents for autonomous software development. It consists of three main components:

- **Backend**: Fastify server with REST API, WebSocket server, and autonomous Kosmos loop
- **Frontend**: React dashboard for monitoring and managing projects, tasks, and agents
- **Agent**: Standalone AI agents (Kosmos, Vicks, Wedge) that execute tasks

## Architecture

```
┌─────────────┐     REST/WebSocket      ┌──────────────────┐
│  Frontend   │ ◄─────────────────────► │     Backend      │
│  (React)    │                         │  (Fastify+WS)    │
└─────────────┘                         └────────┬─────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
              ┌─────┴─────┐              ┌───────┴───────┐              ┌──────┴──────┐
              │  Kosmos   │              │    Vicks      │              │   Wedge     │
              │(Orchestr.)│              │ (Developer)   │              │    (QA)     │
              └───────────┘              └───────────────┘              └─────────────┘
                    │                         │                               │
                    └─────────────────────────┴───────────────────────────────┘
                                              │
                                    MCP (HTTP POST)
```

## Components

### Backend (`apps/backend`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Fastify server entry, registers routes, starts Kosmos loop |
| `src/ws-server.ts` | WebSocket server for real-time activity broadcasts |
| `src/db/sqlite-client.ts` | SQLite database operations |
| `src/db/migrate.ts` | Database migrations |
| `src/routes/index.ts` | REST API routes (projects, tasks, etc.) |
| `src/routes/mcp.ts` | MCP protocol endpoints for agent communication |
| `src/services/kosmos-loop.ts` | Autonomous orchestration loop - assigns tasks to Vicks |
| `src/services/agent-spawner.ts` | Spawns/kills agent processes |
| `src/services/kanban.ts` | Task management (CRUD, move between columns) |
| `src/services/git.ts` | Git operations (init, worktree creation) |
| `src/services/config.ts` | Configuration management |

### Agent (`apps/agent`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Agent entry point, loads profile, runs agent loop |
| `src/mcp-client.ts` | Client for MCP server communication |

**Agent Profiles** (`config/profiles/`):

| Profile | Role | Behavior |
|---------|------|----------|
| `kosmos` | Orchestrator | Polls for TODO tasks, initializes git workspace, delegates to Vicks |
| `vicks` | Developer | Picks up PROGRESS tasks, implements changes via LLM, moves to QA |
| `wedge` | QA | Reviews QA tasks, approves or rejects based on LLM response |

### Frontend (`apps/frontend`)

| Path | Purpose |
|------|---------|
| `src/stores/` | Zustand stores (project, agent, activity, ui, toast) |
| `src/hooks/useWebSocket.ts` | WebSocket connection for real-time updates |
| `src/components/dashboard/` | Main dashboard view and live activity modal |
| `src/components/kanban/` | Kanban board and modal |
| `src/components/task/` | Task detail modal |
| `src/components/layout/` | AppShell, Header, ThemeProvider |
| `src/lib/api.ts` | REST API client |

## Workflow

1. **Kosmos Loop** (runs every 5 seconds):
   - Finds projects with TODO tasks
   - Initializes git worktree for task workspace
   - Moves task to PROGRESS and assigns to "vicks"
   - Broadcasts activity via WebSocket
   - Spawns Vicks agent

2. **Vicks Loop**:
   - Finds tasks assigned to "vicks" in PROGRESS
   - Gets task context and comments via MCP
   - Calls LLM with system prompt + task details
   - Adds implementation notes as comment
   - Moves task to QA
   - Spawns Wedge agent

3. **Wedge Loop**:
   - Finds tasks in QA column
   - Reviews implementation notes from Vicks
   - Calls LLM to approve/reject
   - Moves to DONE or rejects back to PROGRESS

## Development Commands

```bash
npm run dev          # Start backend (port 18792)
npm run dev:frontend # Start frontend (Vite)
npm run dev:agent    # Start agent (dev mode)
npm run build        # Build all packages
npm run lint         # Lint all workspaces
npm run typecheck    # TypeScript check all workspaces
```

## Ports

- Backend REST: `18792`
- WebSocket: `18793`
- Frontend: `5173` (dev)

## Key Technologies

- **Backend**: Fastify, WebSocket (ws), SQLite (better-sqlite3), TypeScript
- **Frontend**: React 18, Vite, TailwindCSS, shadcn/ui, Zustand
- **Agents**: MCP (Model Context Protocol), Ollama/OpenAI compatible LLMs