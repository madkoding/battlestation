# BattleStation

BattleStation is an AI agent orchestration platform for software delivery.

In simple terms, it gives you a Kanban board + API + autonomous agents to turn tasks into implemented and reviewed work, with end-to-end traceability.

## What problem it solves

- Coordinate technical tasks without losing context.
- Automate the `TODO -> PROGRESS -> QA -> DONE` flow.
- Delegate implementation and validation to specialized agents.
- Keep evidence and task state in one place.

## How it works

BattleStation is split into three parts:

- **Backend**: exposes REST/WebSocket, stores project/task state, and runs the orchestration loop.
- **Frontend**: dashboard to view projects, Kanban board, live activity, and task details.
- **Agents**:
  - `kosmos`: orchestrator (selects tasks, assigns flow).
  - `vicks`: developer (implements changes).
  - `wedge`: QA (validates and approves/rejects).

## Expected outcome

When a task enters the system, BattleStation can move it through the full flow with minimal human intervention, leaving comments, decisions, and evidence along the way.

## Project status

This repository is under active development. The goal is to provide a practical local-first foundation for small teams that want to automate delivery with agents.

## Quick start (`battlestation.sh`)

Use the helper script from the repository root:

```bash
./battlestation.sh
```

By default it runs a doctor check and validates your local setup.

### Common commands

```bash
./battlestation.sh doctor   # run diagnostics
./battlestation.sh start    # start backend + frontend
./battlestation.sh status   # show service status
./battlestation.sh stop     # stop all services
```

### What `start` does

- Stops previous Battlestation processes (if any).
- Runs health checks (Node/npm, ports, profiles, provider health).
- Starts Backend on `http://localhost:18792`.
- Starts Frontend (usually `http://localhost:5173`, fallback ports supported by Vite).
- Writes logs to `.logs/` and process ids to `.pids/`.

### Requirements

- Node.js + npm installed.
- Project dependencies installed (`npm install --workspaces`).
- If you want agents to run LLM tasks, configure a provider in Settings and keep it healthy.

After startup, open the frontend URL shown by the script output.
