import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_RUNTIME_POLICY,
  loadRuntimePolicy,
  parsePolicyMarkdown,
} from './policy'

test('parsePolicyMarkdown parses nested YAML frontmatter', () => {
  const parsed = parsePolicyMarkdown(`---
classification:
  frontend_task_pattern: "react|vite"
planning:
  max_commands: 2
  max_effective_commands: 5
---
# policy body ignored
`) as Record<string, unknown>

  const classification = parsed.classification as Record<string, unknown>
  const planning = parsed.planning as Record<string, unknown>
  assert.equal(classification?.frontend_task_pattern, 'react|vite')
  assert.equal(planning?.max_commands, 2)
  assert.equal(planning?.max_effective_commands, 5)
})

test('loadRuntimePolicy merges global and agent override policies', () => {
  const root = mkdtempSync(join(tmpdir(), 'policy-merge-'))
  mkdirSync(join(root, 'vicks'), { recursive: true })

  writeFileSync(join(root, 'POLICY.md'), `---
planning:
  max_commands: 2
delivery_gate:
  require_code_delta: false
context:
  window_tokens: 96000
---
global policy
`)

  writeFileSync(join(root, 'vicks', 'POLICY.md'), `---
planning:
  max_commands: 7
  max_structured_ops: 11
delivery_gate:
  require_frontend_qa_evidence: false
---
agent policy
`)

  const policy = loadRuntimePolicy({ profilesRoot: root, target: 'vicks' })

  assert.equal(policy.agent, 'vicks')
  assert.equal(policy.planning.max_commands, 7)
  assert.equal(policy.planning.max_structured_ops, 11)
  assert.equal(policy.delivery_gate.require_code_delta, false)
  assert.equal(policy.delivery_gate.require_frontend_qa_evidence, false)
  assert.equal(policy.context.window_tokens, 96000)
  assert.equal(policy.context.input_budget_ratio, DEFAULT_RUNTIME_POLICY.context.input_budget_ratio)
})
