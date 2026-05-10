import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatQaDecisionForPrompt,
  normalizeQaDecisionObject,
  parseJsonObjectLoose,
  resolveQaDecision,
} from './qa-decision'

test('parseJsonObjectLoose parses fenced JSON payload', () => {
  const raw = 'prefix\n```json\n{"decision":"approve","summary":"ok"}\n```\nsuffix'
  const parsed = parseJsonObjectLoose(raw)

  assert.equal(parsed?.decision, 'approve')
  assert.equal(parsed?.summary, 'ok')
})

test('normalizeQaDecisionObject normalizes aliases and clamps confidence', () => {
  const normalized = normalizeQaDecisionObject(
    {
      status: 'rework',
      reason: 'missing screenshots',
      blockers: ['missing evidence'],
      evidence_refs: ['qa/shot.png'],
      confidence: 10,
    },
    'structured',
  )

  assert.equal(normalized?.decision, 'reject')
  assert.equal(normalized?.summary, 'missing screenshots')
  assert.deepEqual(normalized?.blockers, ['missing evidence'])
  assert.deepEqual(normalized?.evidence_refs, ['qa/shot.png'])
  assert.equal(normalized?.confidence, 1)
})

test('resolveQaDecision returns structured decision without repair call', async () => {
  const result = await resolveQaDecision({
    policyAgent: 'wedge',
    inputBudget: 4096,
    rawResponse: '{"decision":"approve","summary":"all good","blockers":[],"evidence_refs":["qa/snap.png"],"confidence":0.8}',
    compactText: (text) => text,
    callLLM: async () => {
      throw new Error('repair should not run')
    },
  })

  assert.equal(result.decision, 'approve')
  assert.equal(result.source, 'structured')
  assert.equal(result.summary, 'all good')
})

test('resolveQaDecision repairs unstructured payload when model returns JSON', async () => {
  const result = await resolveQaDecision({
    policyAgent: 'wedge',
    inputBudget: 4096,
    rawResponse: 'Looks okay but needs formal decision output.',
    compactText: (text) => text,
    callLLM: async () => '{"decision":"reject","summary":"missing strict evidence","blockers":["no screenshot links"],"evidence_refs":[],"confidence":0.51}',
  })

  assert.equal(result.decision, 'reject')
  assert.equal(result.source, 'repaired')
  assert.deepEqual(result.blockers, ['no screenshot links'])
})

test('resolveQaDecision fails closed when parsing still fails', async () => {
  const result = await resolveQaDecision({
    policyAgent: 'wedge',
    inputBudget: 4096,
    rawResponse: 'unstructured output',
    compactText: (text) => text,
    callLLM: async () => 'still not valid json',
  })

  assert.equal(result.decision, 'reject')
  assert.equal(result.source, 'fallback')
  assert.equal(result.blockers[0], 'QA reviewer output was not parseable structured JSON')
})

test('formatQaDecisionForPrompt renders markdown summary fields', () => {
  const rendered = formatQaDecisionForPrompt({
    decision: 'approve',
    summary: 'quality checks passed',
    blockers: [],
    evidence_refs: ['qa/snap-home.png'],
    confidence: 0.9,
    source: 'structured',
  })

  assert.match(rendered, /Decision: approve/)
  assert.match(rendered, /Summary: quality checks passed/)
  assert.match(rendered, /qa\/snap-home\.png/)
})
