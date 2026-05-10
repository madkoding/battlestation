import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPlaywrightScreenshots } from './playwright-runner'

test('runPlaywrightScreenshots validates required params', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'pw-runner-workspace-'))
  const output = join(workspace, 'shots')

  const missingUrl = await runPlaywrightScreenshots({
    workspacePath: workspace,
    outputDir: output,
    urls: [],
  })
  assert.equal(missingUrl.ok, false)
  assert.equal(missingUrl.reason, 'At least one URL is required')

  const missingOutput = await runPlaywrightScreenshots({
    workspacePath: workspace,
    outputDir: '',
    urls: ['http://127.0.0.1:5173'],
  })
  assert.equal(missingOutput.ok, false)
  assert.equal(missingOutput.reason, 'Output directory is required')
})

test('runPlaywrightScreenshots requires real workspace path', async () => {
  const result = await runPlaywrightScreenshots({
    workspacePath: '/tmp/does-not-exist-battlestation',
    outputDir: '/tmp/opencode/playwright-out',
    urls: ['http://127.0.0.1:18794'],
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'Workspace path is missing or not found')
})
