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
npm run test         # Run all workspace tests (194 total, 0 failures)
```

## Ports

- Backend REST: `18792`
- WebSocket: `18793`
- Frontend: `5173` (dev)

## Key Technologies

- **Backend**: Fastify, WebSocket (ws), SQLite (better-sqlite3), TypeScript
- **Frontend**: React 18, Vite, TailwindCSS, shadcn/ui, Zustand
- **Agents**: MCP (Model Context Protocol), Ollama/OpenAI compatible LLMs

## Anchored Summary

### Goal
Auditar y corregir el proyecto battlestation (plataforma de orquestación de agentes AI), priorizando seguridad, arquitectura correcta y fiabilidad.

### Constraints & Preferences
- Sin autenticación (local-first)
- Sin containerización
- Tests se agregan post-fixes

### Progress
- **Fase 1-7B**: SQL parametrizado, WS reconnect, CSS tokens, merge worktree, kosmos loop, MCP timeout, DB transactions, broadcasts, git security, path validation — todas completadas.
- **8A-8G**: Zod routes, duplicados → shared, catch :unknown, deps + magic numbers, component refactors, agent loops extract, frontend types → shared — todas completadas.
- **8H Tests**: 194 tests totales (0 fallos). 13 shared + 100 agent (25 agent-utils + 13 mcp-client + 57 nuevas pure functions + 5 QA decision) + 81 backend (53 kanban/workspace-fs/git + 28 MCP+REST integration).
- **Performance**: `saveDb` con debounce 200ms, 5 índices DB, DELETE optimizado O(n²)→O(1).
- **Optimización**: `POLICY_CACHE_TTL_MS` extraído a `@kosmos/shared`.
- **Bugfix**: `POST /api/projects/:id/tasks` project_id desde URL params. `gitDeleteWorktree` usa `git worktree remove` antes de `branch -D`.

### In Progress
- **Agent loops tests**: funciones loop no exportadas desde `index.ts` — se requiere refactor menor para exportar `runVicksLoop`/`runWedgeLoop`.

### Blocked
- (none)

### Key Decisions
- `execSync` en `git.ts` reemplazado por `spawnSync` con args array
- Workspace paths restringidos a `~/.kosmos`, `$CWD`, `/tmp` en `WORKSPACE_ALLOWED_ROOTS` en shared
- Zod schemas centralizados en `@kosmos/shared`
- BEGIN/COMMIT/ROLLBACK manual (no async-safe transaction helper)
- Componentes grandes extraídos a sub-componentes + hooks custom
- Funciones puras del agente separadas en `agent-utils.ts`, pasando dependencias MCP como parámetros
- `asRecord` tipo genérico `Record<string, unknown>` unifica las 4 impl previas
- `WORKSPACE_ALLOWED_ROOTS` en helpers.ts con guard `typeof process !== 'undefined'` para compatibilidad browser
- `saveDb` debounced 200ms
- Tests de integración usan `fastify.inject()`
- Tests MCP Client usan servidor HTTP mockeado local

### Next Steps
1. **Agent loops tests**: exportar `runVicksLoop`/`runWedgeLoop` desde `index.ts`, mockear MCP + LLM con `mock.module()`
2. **CI/CD**: GitHub Actions para typecheck + lint + test en cada PR
3. **Frontend**: code-splitting, lazy loading, reducir bundle size (actual 861 kB)

### Critical Context
- sql.js es síncrono — no soporta async/await en `db.run()`/`db.exec()`. `execParams()` usa `prepare()`+`bind()`+`step()`.
- `z.parse()` lanza error si falla — Fastify lo atrapa y responde 500. Usar `z.safeParse()` si se requiere 400.
- `git.ts` ya no usa shell — `spawnSync('git', args, { cwd })` con `timeout: 30000`.
- `agent-utils.ts` contiene 38 funciones puras exportadas (748ln). `index.ts` importa desde allí y mantiene solo MCP-dependent orchestration + Vicks/Wedge loops.
- Las funciones loop (`runVicksLoop`, `runWedgeLoop`) NO están exportadas — definidas inline en `index.ts`. `callLLM` también es inline.
- `saveDb` con debounce 200ms: `flushDb(db)` exportada para cierre graceful. Tests pasan 100%.
- Total tests: 194, all pass.

### Relevant Files
- `apps/agent/src/agent-utils.ts`: 38 functions, 748 lines
- `apps/agent/src/agent-utils.test.ts`: 133 → 400+ lines, 57 new tests
- `apps/agent/src/index.ts`: Vicks loop line 539, Wedge loop line 806, callLLM inline line 155
