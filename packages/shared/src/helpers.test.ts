import test from 'node:test'
import assert from 'node:assert/strict'
import { asRecord, sleep, WORKSPACE_ALLOWED_ROOTS, DEFAULT_TIMEOUT_MS, DEFAULT_PORT, DEFAULT_POLL_MS, POLICY_CACHE_TTL_MS } from './helpers'

test('asRecord returns empty object for null/undefined', () => {
  assert.deepEqual(asRecord(null), {})
  assert.deepEqual(asRecord(undefined), {})
})

test('asRecord returns empty object for primitives', () => {
  assert.deepEqual(asRecord(42), {})
  assert.deepEqual(asRecord('string'), {})
  assert.deepEqual(asRecord(true), {})
})

test('asRecord returns empty object for arrays', () => {
  assert.deepEqual(asRecord([1, 2, 3]), {})
})

test('asRecord returns object as-is', () => {
  const obj = { a: 1, b: 'hello' }
  const result = asRecord(obj)
  assert.equal(result.a, 1)
  assert.equal(result.b, 'hello')
})

test('asRecord preserves nested objects', () => {
  const obj = { nested: { key: 'value' } }
  const result = asRecord(obj)
  assert.deepEqual(result.nested, { key: 'value' })
})

test('sleep resolves after given ms', async () => {
  const start = Date.now()
  await sleep(10)
  const elapsed = Date.now() - start
  assert.ok(elapsed >= 5)
})

test('WORKSPACE_ALLOWED_ROOTS is a non-empty array', () => {
  assert.ok(Array.isArray(WORKSPACE_ALLOWED_ROOTS))
  assert.ok(WORKSPACE_ALLOWED_ROOTS.length > 0)
})

test('DEFAULT_TIMEOUT_MS is 120000', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 120_000)
})

test('DEFAULT_PORT is 18792', () => {
  assert.equal(DEFAULT_PORT, 18792)
})

test('DEFAULT_POLL_MS is 5000', () => {
  assert.equal(DEFAULT_POLL_MS, 5000)
})

test('POLICY_CACHE_TTL_MS is 5000', () => {
  assert.equal(POLICY_CACHE_TTL_MS, 5000)
})
