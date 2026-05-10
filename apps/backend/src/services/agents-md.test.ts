import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  compactAgentsInstructionsForPrompt,
  readProjectAgentsMd,
  writeProjectAgentsMd,
} from './agents-md'

test('readProjectAgentsMd returns default template when AGENTS.md is missing', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'agents-md-read-'))

  const document = readProjectAgentsMd({
    projectId: 'project-1',
    projectName: 'Demo Project',
    projectPath: projectRoot,
  })

  assert.equal(document.exists, false)
  assert.equal(document.path, join(projectRoot, 'AGENTS.md'))
  assert.match(document.content, /^# Demo Project - Agent Instructions/m)
  assert.match(document.content, /## Project Overview/)
})

test('writeProjectAgentsMd persists custom content and readProjectAgentsMd returns it', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'agents-md-write-'))

  const written = writeProjectAgentsMd({
    projectId: 'project-2',
    projectName: 'Storage Project',
    projectPath: projectRoot,
    content: '# Custom\n\n- Keep tests deterministic',
  })

  assert.equal(written.exists, true)
  assert.equal(written.path, join(projectRoot, 'AGENTS.md'))

  const saved = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf-8')
  assert.equal(saved, '# Custom\n\n- Keep tests deterministic\n')

  const readBack = readProjectAgentsMd({
    projectId: 'project-2',
    projectName: 'Storage Project',
    projectPath: projectRoot,
  })

  assert.equal(readBack.exists, true)
  assert.equal(readBack.path, join(projectRoot, 'AGENTS.md'))
  assert.equal(readBack.content, '# Custom\n\n- Keep tests deterministic\n')
})

test('compactAgentsInstructionsForPrompt preserves head and tail around compact marker', () => {
  const source = `HEAD\n${'x'.repeat(2000)}\nTAIL`
  const compacted = compactAgentsInstructionsForPrompt(source, 800)

  assert.match(compacted, /^HEAD/m)
  assert.match(compacted, /\[project instructions compacted\]/)
  assert.match(compacted, /TAIL$/m)
})
