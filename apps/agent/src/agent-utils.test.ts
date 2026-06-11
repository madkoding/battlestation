import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asUnknownArray,
  asStringArray,
  asWorkspaceExecResult,
  asWorktreeArtifacts,
  asQaEvidencePayload,
  asTaskRecordArray,
  asProjectRecordArray,
  asCommentRecordArray,
  isTestCommand,
  isInstallCommand,
  estimateTokenCount,
  compactFreeText,
  compactProjectInstructions,
  compactCommentsForPrompt,
  trimToCommentLimit,
  extractHeadline,
  resolveWorktreePath,
  taskSortTimestamp,
  getInputBudget,
  countDeliveryGateBlocks,
  isDocumentationOnlyTask,
  normalizePlanOps,
  buildTaskClassifiers,
  getLoopSleepMs,
  formatArtifactsForPrompt,
  isLikelyFrontendTask,
  getLatestQaEvidencePayload,
  collectQaScreenshotRefs,
  formatQaScreenshotMarkdown,
  appendCommentSection,
  shouldRunFrontendQaEvidence,
  formatQaEvidenceForPrompt,
  evaluateDeliveryGate,
  parseJsonPlan,
} from './agent-utils'
import type { RuntimePolicy } from '@kosmos/shared'
import type { Profile } from './agent-utils'

test('asUnknownArray returns empty array for non-arrays', () => {
  assert.deepEqual(asUnknownArray(null), [])
  assert.deepEqual(asUnknownArray(undefined), [])
  assert.deepEqual(asUnknownArray('string'), [])
  assert.deepEqual(asUnknownArray({}), [])
})

test('asUnknownArray returns array as-is', () => {
  const arr = [1, 'two', { three: true }]
  assert.deepEqual(asUnknownArray(arr), arr)
})

test('asStringArray filters to strings', () => {
  assert.deepEqual(asStringArray(['hello', '', 'world', null, 42, undefined]), ['hello', 'world', '42'])
})

test('isTestCommand matches test patterns', () => {
  assert.ok(isTestCommand('npm run test'))
  assert.ok(isTestCommand('npx vitest'))
  assert.ok(isTestCommand('npx jest'))
  assert.ok(isTestCommand('pytest tests/'))
  assert.ok(isTestCommand('cargo test'))
  assert.ok(isTestCommand('yarn run test'))
})

test('isTestCommand rejects non-test commands', () => {
  assert.ok(!isTestCommand('npm run build'))
  assert.ok(!isTestCommand('ls -la'))
  assert.ok(!isTestCommand('echo hello'))
  assert.ok(!isTestCommand('git push'))
})

test('isInstallCommand matches install patterns', () => {
  assert.ok(isInstallCommand('npm install'))
  assert.ok(isInstallCommand('pnpm add lodash'))
  assert.ok(isInstallCommand('pip install flask'))
  assert.ok(isInstallCommand('playwright install'))
})

test('isInstallCommand rejects non-install commands', () => {
  assert.ok(!isInstallCommand('npm run build'))
  assert.ok(!isInstallCommand('ls'))
  assert.ok(!isInstallCommand('go mod download'))
})

test('estimateTokenCount approximates token count', () => {
  assert.equal(estimateTokenCount(''), 0)
  assert.ok(estimateTokenCount('hello world') > 0)
  assert.ok(estimateTokenCount('a'.repeat(1000)) > 100)
})

test('compactFreeText truncates text exceeding token limit', () => {
  const longText = 'line one\nline two\nline three\nline four\nline five\n'
  const compacted = compactFreeText(longText, 1)
  assert.ok(typeof compacted === 'string')
  assert.ok(compacted.length > 0)
})

test('compactFreeText returns original text within limit', () => {
  const shortText = 'short text'
  assert.equal(compactFreeText(shortText, 1000), shortText)
})

test('extractHeadline extracts first meaningful line', () => {
  const text = '## Summary\n\nSome details here.\n\nMore content.'
  assert.equal(extractHeadline(text, 'fallback'), 'Summary')
})

test('extractHeadline falls back to first non-empty line', () => {
  const text = '\n\nSome content\nmore'
  assert.equal(extractHeadline(text, 'fallback'), 'Some content')
})

test('extractHeadline returns fallback for empty text', () => {
  assert.equal(extractHeadline('', 'fallback'), 'fallback')
  assert.equal(extractHeadline('   \n\n  ', 'fallback'), 'fallback')
})

test('resolveWorktreePath returns joined path', () => {
  const task = { workspace_path: '/workspace/test-project' } as Record<string, unknown>
  assert.equal(resolveWorktreePath(task), '/workspace/test-project')
})

test('resolveWorktreePath returns empty for no path', () => {
  assert.equal(resolveWorktreePath({}), '')
})

test('taskSortTimestamp returns negative timestamp from date', () => {
  const a = { updated_at: '2024-01-02' } as Record<string, unknown>
  const result = taskSortTimestamp(a)
  assert.equal(typeof result, 'number')
  assert.ok(Number.isFinite(result))
})

test('taskSortTimestamp handles missing updated_at via created_at', () => {
  const a = { created_at: '2024-01-02' } as Record<string, unknown>
  const result = taskSortTimestamp(a)
  assert.equal(typeof result, 'number')
  assert.ok(Number.isFinite(result))
})

test('parseJsonPlan parses valid JSON', () => {
  const json = JSON.stringify({
    commands: ['npm run test'],
    checks: ['check log'],
    ops: [{ tool: 'workspace_exec', args: { command: 'ls' } }],
  })
  const result = parseJsonPlan(json)
  assert.ok(result)
  assert.deepEqual(result!.commands, ['npm run test'])
  assert.equal(result!.ops.length, 1)
})

test('parseJsonPlan returns null for invalid JSON', () => {
  assert.equal(parseJsonPlan('not json'), null)
  assert.equal(parseJsonPlan(''), null)
  assert.equal(parseJsonPlan('{invalid}'), null)
})

test('asWorkspaceExecResult handles all fields', () => {
  const result = asWorkspaceExecResult({ ok: true, stdout: 'hello', stderr: '' })
  assert.equal(result.ok, true)
  assert.equal(result.stdout, 'hello')
  assert.equal(result.stderr, '')
})

test('asWorkspaceExecResult handles partial/empty input', () => {
  const result = asWorkspaceExecResult({})
  assert.equal(result.ok, undefined)
  assert.equal(result.stdout, undefined)
  assert.equal(result.stderr, undefined)
})

test('asWorktreeArtifacts returns null for empty record', () => {
  assert.equal(asWorktreeArtifacts({}), null)
})

test('asWorktreeArtifacts parses valid artifacts', () => {
  const result = asWorktreeArtifacts({
    exists: true,
    changed_files: ['a.ts'],
    recent_commits: ['fix: thing'],
    files_between_branches: ['b.ts'],
  })
  assert.equal(result?.exists, true)
  assert.deepEqual(result?.changed_files, ['a.ts'])
  assert.deepEqual(result?.recent_commits, ['fix: thing'])
  assert.deepEqual(result?.files_between_branches, ['b.ts'])
})

test('asWorktreeArtifacts omits empty arrays', () => {
  const result = asWorktreeArtifacts({ exists: false, changed_files: [] })
  assert.equal(result?.exists, false)
  assert.equal(result?.changed_files, undefined)
})

test('asQaEvidencePayload returns null for empty record', () => {
  assert.equal(asQaEvidencePayload({}), null)
})

test('asQaEvidencePayload parses payload with screenshots and logs', () => {
  const result = asQaEvidencePayload({
    executed: true,
    reason: 'done',
    base_url: 'http://localhost:5173',
    script: 'test.js',
    screenshots: [{ path: '/tmp/shot.png', url: 'http://localhost:5173', viewport: '1280x720' }],
    logs: ['[info] start'],
  })
  assert.equal(result?.executed, true)
  assert.equal(result?.reason, 'done')
  assert.equal(result?.base_url, 'http://localhost:5173')
  assert.equal(result?.screenshots?.length, 1)
  assert.equal(result?.logs?.length, 1)
})

test('asQaEvidencePayload filters invalid screenshots', () => {
  const result = asQaEvidencePayload({
    executed: true,
    screenshots: [null, 'string', { path: '/valid.png' }],
    logs: 'not an array',
  })
  assert.equal(result?.screenshots?.length, 1)
  assert.equal(result?.logs, undefined)
})

test('asTaskRecordArray returns empty for non-array', () => {
  assert.deepEqual(asTaskRecordArray(null), [])
  assert.deepEqual(asTaskRecordArray('string'), [])
})

test('asTaskRecordArray wraps items as records', () => {
  const result = asTaskRecordArray([{ id: 1 }, { id: 2 }])
  assert.equal(result.length, 2)
  assert.equal(result[0].id, 1)
})

test('asProjectRecordArray returns empty for non-array', () => {
  assert.deepEqual(asProjectRecordArray(null), [])
})

test('asProjectRecordArray wraps items as records', () => {
  const result = asProjectRecordArray([{ name: 'test' }])
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'test')
})

test('asCommentRecordArray returns empty for non-array', () => {
  assert.deepEqual(asCommentRecordArray(undefined), [])
})

test('asCommentRecordArray wraps items as records', () => {
  const result = asCommentRecordArray([{ comment: 'hello', agent_name: 'wedge' }])
  assert.equal(result.length, 1)
  assert.equal(result[0].comment, 'hello')
})

test('getInputBudget computes budget from profile and policy', () => {
  const profile = { max_tokens: 4096 } as unknown as Profile
  const policy = { context: { window_tokens: 128000, input_budget_ratio: 0.72 } } as unknown as RuntimePolicy
  const budget = getInputBudget(profile, policy)
  assert.ok(budget >= 8000)
  assert.ok(budget < 100000)
})

test('getInputBudget respects minimum floor', () => {
  const profile = { max_tokens: 256 } as unknown as Profile
  const policy = { context: { window_tokens: 1000, input_budget_ratio: 0.1 } } as unknown as RuntimePolicy
  assert.equal(getInputBudget(profile, policy), 8000)
})

test('compactProjectInstructions truncates long text', () => {
  const long = 'x'.repeat(20000)
  const result = compactProjectInstructions(long, 2000)
  assert.ok(result.length < 2000)
  assert.ok(result.includes('compacted'))
})

test('compactProjectInstructions returns short text as-is', () => {
  assert.equal(compactProjectInstructions('short text', 20000), 'short text')
})

test('compactProjectInstructions returns empty for blank text', () => {
  assert.equal(compactProjectInstructions(''), '')
  assert.equal(compactProjectInstructions('  '), '')
})

test('compactCommentsForPrompt returns "- none" for empty comments', () => {
  assert.equal(compactCommentsForPrompt([], 1000), '- none')
  assert.equal(compactCommentsForPrompt(undefined as unknown as Record<string, unknown>[], 1000), '- none')
})

test('compactCommentsForPrompt serializes comments within token budget', () => {
  const comments = [
    { comment: 'first note', agent_name: 'vicks', created_at: '2024-01-01T00:00:00Z' },
    { comment: 'second note', agent_name: 'wedge', created_at: '2024-01-02T00:00:00Z' },
  ]
  const result = compactCommentsForPrompt(comments, 10000)
  assert.ok(result.includes('vicks'))
  assert.ok(result.includes('wedge'))
  assert.ok(result.includes('first note'))
})

test('compactCommentsForPrompt compactifies when over budget', () => {
  const comments = Array.from({ length: 50 }, (_, i) => ({
    comment: `comment number ${i}`.repeat(100),
    agent_name: i % 2 === 0 ? 'vicks' : 'wedge',
    created_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }))
  const result = compactCommentsForPrompt(comments, 100)
  assert.ok(typeof result === 'string')
  assert.ok(result.length > 0)
})

test('trimToCommentLimit returns text within limit', () => {
  assert.equal(trimToCommentLimit('hello world', 4000), 'hello world')
})

test('trimToCommentLimit truncates long text with marker', () => {
  const long = 'x'.repeat(5000)
  const result = trimToCommentLimit(long, 400)
  assert.ok(result.length <= 400 + '\n\n[truncated]'.length)
  assert.ok(result.endsWith('[truncated]'))
})

test('trimToCommentLimit returns empty for blank text', () => {
  assert.equal(trimToCommentLimit('', 4000), '')
  assert.equal(trimToCommentLimit('  ', 4000), '')
})

test('countDeliveryGateBlocks counts wedge comments with marker', () => {
  const comments = [
    { agent_name: 'vicks', comment: '## Delivery Gate Blocked\nsomething wrong' },
    { agent_name: 'wedge', comment: '## Delivery Gate Blocked\nnot counted' },
    { agent_name: 'vicks', comment: 'normal note' },
    { agent_name: 'vicks', comment: '## Delivery Gate Blocked\nagain' },
  ]
  assert.equal(countDeliveryGateBlocks(comments, '## Delivery Gate Blocked'), 2)
})

test('countDeliveryGateBlocks returns 0 for no matches', () => {
  assert.equal(countDeliveryGateBlocks([], '## Delivery Gate Blocked'), 0)
})

test('isDocumentationOnlyTask matches documentation pattern', () => {
  const pattern = /documentation|docs|readme/i
  assert.ok(isDocumentationOnlyTask({ title: 'Update README' } as Record<string, unknown>, pattern))
  assert.ok(isDocumentationOnlyTask({ title: '', description: 'Add documentation' } as Record<string, unknown>, pattern))
})

test('isDocumentationOnlyTask rejects non-documentation', () => {
  const pattern = /documentation|docs|readme/i
  assert.ok(!isDocumentationOnlyTask({ title: 'Add login feature' } as Record<string, unknown>, pattern))
})

test('normalizePlanOps filters and caps by allowed tools', () => {
  const raw = [
    { tool: 'read', args: { path: '/' } },
    { tool: 'INVALID', args: {} },
    { tool: 'write', args: { path: '/file' } },
    { tool: 'delete', args: {} },
  ]
  const result = normalizePlanOps(raw, 3)
  assert.equal(result.length, 3)
  assert.equal(result[0].tool, 'read')
  assert.equal(result[1].tool, 'write')
})

test('normalizePlanOps returns empty for non-array', () => {
  assert.deepEqual(normalizePlanOps(null as unknown as unknown[], 8), [])
})

test('buildTaskClassifiers compiles regex from policy', () => {
  const policy = {
    classification: {
      frontend_task_pattern: 'ui|component|page|view',
      documentation_task_pattern: 'readme|docs|documentation',
    },
  } as unknown as RuntimePolicy
  const { frontend, documentation } = buildTaskClassifiers(policy)
  assert.ok(frontend instanceof RegExp)
  assert.ok(documentation instanceof RegExp)
  assert.ok(frontend.test('Add UI component'))
  assert.ok(documentation.test('Update README'))
})

test('getLoopSleepMs extracts sleep values from policy', () => {
  const policy = { loop: { idle_sleep_ms: 1000, error_sleep_ms: 2000, escalation_sleep_ms: 15000 } } as unknown as RuntimePolicy
  const result = getLoopSleepMs(policy)
  assert.equal(result.idle, 1000)
  assert.equal(result.error, 2000)
  assert.equal(result.escalation, 15000)
})

test('getLoopSleepApplies defaults and minimum floor', () => {
  const policy = { loop: {} } as unknown as RuntimePolicy
  const result = getLoopSleepMs(policy)
  assert.ok(result.idle >= 250)
  assert.ok(result.error >= 250)
  assert.ok(result.escalation >= 250)
})

test('formatArtifactsForPrompt handles null/absent worktree', () => {
  assert.equal(formatArtifactsForPrompt(null), 'Worktree not found or not available.')
  assert.equal(formatArtifactsForPrompt({ exists: false }), 'Worktree not found or not available.')
})

test('formatArtifactsForPrompt formats with all data', () => {
  const result = formatArtifactsForPrompt({
    exists: true,
    changed_files: ['src/foo.ts', 'src/bar.ts'],
    recent_commits: ['add feature', 'fix bug'],
    files_between_branches: ['src/foo.ts'],
  })
  assert.ok(result.includes('src/foo.ts'))
  assert.ok(result.includes('add feature'))
  assert.ok(result.includes('changed_files_count: 2'))
})

test('formatArtifactsForPrompt handles missing sections', () => {
  const result = formatArtifactsForPrompt({ exists: true })
  assert.ok(result.includes('- None detected from git status'))
  assert.ok(result.includes('- No recent commits detected'))
})

test('isLikelyFrontendTask matches frontend signals', () => {
  const frontendPattern = /ui|component|page/
  const docPattern = /readme|docs/
  assert.ok(isLikelyFrontendTask({ title: 'Add user page' } as Record<string, unknown>, frontendPattern, docPattern))
})

test('isLikelyFrontendTask returns false for doc-only task', () => {
  const frontendPattern = /ui|component|page/
  const docPattern = /readme|docs/
  assert.ok(!isLikelyFrontendTask({ title: 'Update README' } as Record<string, unknown>, frontendPattern, docPattern))
})

test('getLatestQaEvidencePayload returns null for empty', () => {
  assert.equal(getLatestQaEvidencePayload([]), null)
  assert.equal(getLatestQaEvidencePayload(null as unknown as unknown[]), null)
})

test('getLatestQaEvidencePayload extracts first entry payload', () => {
  const entries = [{ payload: { executed: true, reason: 'ok' } }]
  const result = getLatestQaEvidencePayload(entries)
  assert.equal(result?.executed, true)
  assert.equal(result?.reason, 'ok')
})

test('collectQaScreenshotRefs returns empty for no taskId', () => {
  assert.deepEqual(collectQaScreenshotRefs('', [{ payload: { screenshots: [{ path: 's.png' }] } }]), [])
})

test('collectQaScreenshotRefs returns empty for no screenshots', () => {
  assert.deepEqual(collectQaScreenshotRefs('task-1', []), [])
})

test('collectQaScreenshotRefs extracts screenshot refs', () => {
  const entries = [{
    id: 'ev-1',
    payload: { screenshots: [{ path: '/s.png', viewport: '1280x720', url: 'http://localhost' }] },
  }]
  const result = collectQaScreenshotRefs('task-1', entries)
  assert.equal(result.length, 1)
  assert.equal(result[0].evidenceId, 'ev-1')
  assert.equal(result[0].viewport, '1280x720')
  assert.ok(result[0].apiUrl.includes('task-1'))
})

test('formatQaScreenshotMarkdown returns empty for no refs', () => {
  assert.equal(formatQaScreenshotMarkdown('task-1', []), '')
})

test('formatQaScreenshotMarkdown builds markdown from refs', () => {
  const entries = [{
    id: 'ev-1',
    payload: { screenshots: [{ path: '/s.png', viewport: '1280x720', url: 'http://localhost' }] },
  }]
  const result = formatQaScreenshotMarkdown('task-1', entries)
  assert.ok(result.includes('## QA Screenshots'))
  assert.ok(result.includes('1280x720'))
})

test('appendCommentSection returns base when no section', () => {
  assert.equal(appendCommentSection('hello', '', 4000), 'hello')
})

test('appendCommentSection appends section within limit', () => {
  const result = appendCommentSection('base', '## QA Screenshots\n![img](url)', 4000)
  assert.ok(result.includes('base'))
  assert.ok(result.includes('QA Screenshots'))
})

test('appendCommentSection skips append if base already has QA Screenshots', () => {
  const result = appendCommentSection('base\n## QA Screenshots\ncontent', 'extra section', 4000)
  assert.ok(!result.includes('extra section'))
})

test('appendCommentSection truncates when over limit', () => {
  const base = 'x'.repeat(100)
  const section = 'y'.repeat(5000)
  const result = appendCommentSection(base, section, 200)
  assert.ok(result.length <= 200 + '[truncated]'.length + 10)
})

test('shouldRunFrontendQaEvidence returns false when policy disables', () => {
  const policy = { delivery_gate: { require_frontend_qa_evidence: false } } as unknown as RuntimePolicy
  assert.equal(shouldRunFrontendQaEvidence({ policy, requiresFrontendEvidence: true, worktreeArtifacts: { changed_files: ['a.ts'] }, latestQaEvidence: null }), false)
})

test('shouldRunFrontendQaEvidence returns false for non-frontend task', () => {
  const policy = { delivery_gate: { require_frontend_qa_evidence: true } } as unknown as RuntimePolicy
  assert.equal(shouldRunFrontendQaEvidence({ policy, requiresFrontendEvidence: false, worktreeArtifacts: { changed_files: ['a.ts'] }, latestQaEvidence: null }), false)
})

test('shouldRunFrontendQaEvidence returns false if no code delta', () => {
  const policy = { delivery_gate: { require_frontend_qa_evidence: true } } as unknown as RuntimePolicy
  assert.equal(shouldRunFrontendQaEvidence({ policy, requiresFrontendEvidence: true, worktreeArtifacts: {}, latestQaEvidence: null }), false)
})

test('shouldRunFrontendQaEvidence returns false if evidence already exists', () => {
  const policy = { delivery_gate: { require_frontend_qa_evidence: true } } as unknown as RuntimePolicy
  assert.equal(shouldRunFrontendQaEvidence({
    policy,
    requiresFrontendEvidence: true,
    worktreeArtifacts: { changed_files: ['a.ts'] },
    latestQaEvidence: { executed: true, screenshots: [{ path: 's.png' }] },
  }), false)
})

test('shouldRunFrontendQaEvidence returns true when all conditions met', () => {
  const policy = { delivery_gate: { require_frontend_qa_evidence: true } } as unknown as RuntimePolicy
  assert.equal(shouldRunFrontendQaEvidence({
    policy,
    requiresFrontendEvidence: true,
    worktreeArtifacts: { changed_files: ['a.ts'] },
    latestQaEvidence: null,
  }), true)
})

test('formatQaEvidenceForPrompt handles null evidence', () => {
  assert.equal(formatQaEvidenceForPrompt(null), 'No QA evidence run.')
  assert.equal(formatQaEvidenceForPrompt(undefined), 'No QA evidence run.')
})

test('formatQaEvidenceForPrompt formats evidence with all fields', () => {
  const result = formatQaEvidenceForPrompt({
    executed: true,
    reason: 'passed',
    base_url: 'http://localhost:5173',
    script: 'test.js',
    screenshots: [{ path: '/s.png', viewport: '1280x720', url: 'http://localhost' }],
    logs: ['[info] done'],
  })
  assert.ok(result.includes('Executed: true'))
  assert.ok(result.includes('Reason: passed'))
  assert.ok(result.includes('1280x720'))
})

test('formatQaEvidenceForPrompt handles empty screenshots and logs', () => {
  const result = formatQaEvidenceForPrompt({ executed: false, reason: 'failed' })
  assert.ok(result.includes('- None'))
})

test('evaluateDeliveryGate passes with code delta and tests', () => {
  const policy = {
    delivery_gate: {
      require_code_delta: true,
      require_tests_for_non_documentation: true,
      require_frontend_qa_evidence: false,
      blocked_comment_marker: '## Delivery Gate Blocked',
    },
    handoff: { max_retry_before_block: 3 },
    classification: { frontend_task_pattern: '', documentation_task_pattern: '' },
  } as unknown as RuntimePolicy
  const result = evaluateDeliveryGate({
    task: { title: 'Fix bug' } as Record<string, unknown>,
    comments: [],
    policy,
    classifiers: { frontend: /ui/, documentation: /docs/ },
    worktreeArtifacts: { changed_files: ['src/foo.ts'], files_between_branches: ['src/bar.ts'] },
    actionExecution: { quality: { test_commands_run: 3, test_commands_passed: 3 } },
    getRuntimePolicy: () => policy,
  })
  assert.equal(result.pass, true)
  assert.equal(result.reasons.length, 0)
})

test('evaluateDeliveryGate fails with no code delta', () => {
  const policy = {
    delivery_gate: {
      require_code_delta: true,
      require_tests_for_non_documentation: false,
      require_frontend_qa_evidence: false,
      blocked_comment_marker: '## Delivery Gate Blocked',
    },
    handoff: { max_retry_before_block: 3 },
    classification: { frontend_task_pattern: '', documentation_task_pattern: '' },
  } as unknown as RuntimePolicy
  const result = evaluateDeliveryGate({
    task: { title: 'Fix bug' } as Record<string, unknown>,
    comments: [],
    policy,
    classifiers: { frontend: /ui/, documentation: /docs/ },
    worktreeArtifacts: { changed_files: [], files_between_branches: [] },
    getRuntimePolicy: () => policy,
  })
  assert.equal(result.pass, false)
  assert.ok(result.reasons.some((r) => r.includes('code delta')))
})

test('evaluateDeliveryGate fails when no tests run for non-doc task', () => {
  const policy = {
    delivery_gate: {
      require_code_delta: false,
      require_tests_for_non_documentation: true,
      require_frontend_qa_evidence: false,
      blocked_comment_marker: '## Delivery Gate Blocked',
    },
    handoff: { max_retry_before_block: 3 },
    classification: { frontend_task_pattern: '', documentation_task_pattern: '' },
  } as unknown as RuntimePolicy
  const result = evaluateDeliveryGate({
    task: { title: 'Fix bug' } as Record<string, unknown>,
    comments: [],
    policy,
    classifiers: { frontend: /ui/, documentation: /docs/ },
    worktreeArtifacts: { changed_files: ['a.ts'] },
    actionExecution: { quality: { test_commands_run: 0, test_commands_passed: 0 } },
    getRuntimePolicy: () => policy,
  })
  assert.equal(result.pass, false)
  assert.ok(result.reasons.some((r) => r.includes('automated tests') || r.includes('No automated tests')))
})

test('evaluateDeliveryGate shouldEscalate when retries exceeded', () => {
  const policy = {
    delivery_gate: {
      require_code_delta: false,
      require_tests_for_non_documentation: false,
      require_frontend_qa_evidence: false,
      blocked_comment_marker: '## Delivery Gate Blocked',
    },
    handoff: { max_retry_before_block: 2 },
    classification: { frontend_task_pattern: '', documentation_task_pattern: '' },
  } as unknown as RuntimePolicy
  const result = evaluateDeliveryGate({
    task: { title: 'Fix bug' } as Record<string, unknown>,
    comments: [
      { agent_name: 'vicks', comment: '## Delivery Gate Blocked\nx' },
      { agent_name: 'vicks', comment: '## Delivery Gate Blocked\ny' },
      { agent_name: 'vicks', comment: '## Delivery Gate Blocked\nz' },
    ],
    policy,
    classifiers: { frontend: /ui/, documentation: /docs/ },
    worktreeArtifacts: { changed_files: ['a.ts'] },
    getRuntimePolicy: () => policy,
  })
  assert.equal(result.pass, true)
  assert.equal(result.shouldEscalate, true)
})
