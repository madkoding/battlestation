import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'

import { runPlaywrightCapture } from './qa-evidence'

test('runPlaywrightCapture returns non-persistent ad-hoc failure when no scripts and no urls', async () => {
  const workspace = mkdtempSync('/tmp/qa-evidence-adhoc-')
  const result = await runPlaywrightCapture({
    workspacePath: workspace,
  })

  assert.equal(result.persisted, false)
  assert.equal(result.executed, false)
  assert.match(String(result.reason || ''), /no frontend dev\/start scripts discovered/i)
})

test('runPlaywrightCapture validates output_subdir path traversal', async () => {
  const workspace = mkdtempSync('/tmp/qa-evidence-safe-')
  await assert.rejects(
    () => runPlaywrightCapture({
      workspacePath: workspace,
      outputSubdir: '../outside-folder',
    }),
    /output_subdir must stay inside workspace path/i,
  )
})
