# Agent Profiles

This directory externalizes agent identity and behavior from Python code.

Each agent has its own folder under this directory, and folder names are used as agent IDs.

Examples:

- `kosmos/`
- `vicks/`
- `wedge/`
- `any-new-agent/`

Supported files per agent:

- `PROFILE.md` (required for metadata overrides)
  - YAML-like front matter keys supported:
    - `name`
    - `role`
    - `description`
    - `model`
    - `temperature`
    - `top_p`
    - `max_tokens`
  - Body content is included at the start of the system prompt.
- `SOUL.md`
- `WORKFLOW.md`
- `STYLE.md`
- `GUARDRAILS.md`
- `MEMORY.md`
- `POLICY.md`
  - Frontmatter YAML is parsed as runtime policy overrides.
  - Global policy can be defined in `config/profiles/POLICY.md`.
  - Agent-specific policy lives in `config/profiles/<agent-id>/POLICY.md` and overrides global values.

Policy merge order:

1. Built-in defaults (`packages/shared/src/policy.ts`)
2. Global policy (`config/profiles/POLICY.md`)
3. Agent policy (`config/profiles/<agent-id>/POLICY.md`)

Prompt assembly order is:

1. `PROFILE.md` body
2. `SOUL.md`
3. `WORKFLOW.md`
4. `STYLE.md`
5. `GUARDRAILS.md`
6. `MEMORY.md`
7. any other `*.md` files in alphabetical order

## Runtime behavior

- Agent ids are discovered dynamically from folder names under this directory.
- `kosmos` is reserved for the orchestrator and is not created as a subagent.
- Any other profile id can be requested as a subagent through the API and factory.
