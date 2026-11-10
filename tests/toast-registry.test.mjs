import test from 'node:test'
import assert from 'node:assert/strict'
import { createToastRegistry, defaultTarget, normalizeToastTarget } from '../lib/attention/toast-registry.js'

test('defaultTarget maps toast kinds onto navigation targets', () => {
  assert.equal(defaultTarget('permission'), 'approval')
  assert.equal(defaultTarget('question'), 'question')
  assert.equal(defaultTarget('sidelinedone'), 'summary')
  assert.equal(defaultTarget('completed'), 'session')
  assert.equal(defaultTarget('failed'), 'session')
})

test('normalizeToastTarget carries session, summary list and interaction key', () => {
  const summary = normalizeToastTarget(
    { kind: 'sidelinedone', sessionId: 's1', sessionIds: ['s1', 's2', 's2', ''], target: 'summary' },
    'summary:1',
  )
  assert.equal(summary.id, 'summary:1')
  assert.equal(summary.sessionId, 's1')
  assert.deepEqual(summary.sessionIds, ['s1', 's2'])
  assert.equal(summary.target, 'summary')

  const approval = normalizeToastTarget(
    { kind: 'permission', sessionId: 's3', interactionKey: 'approval:7' },
    'pending:7',
  )
  assert.equal(approval.sessionId, 's3')
  assert.deepEqual(approval.sessionIds, ['s3'])
  assert.equal(approval.target, 'approval')
  assert.equal(approval.interactionKey, 'approval:7')

  const fallback = normalizeToastTarget({ kind: 'completed', sessionIds: ['s4'] }, 'x')
  assert.equal(fallback.sessionId, 's4')
  assert.equal(fallback.target, 'session')
  assert.equal(fallback.interactionKey, null)
})

test('normalizeToastTarget ignores unknown targets and empty payloads', () => {
  const unknown = normalizeToastTarget({ kind: 'failed', target: 'bogus' }, 'x')
  assert.equal(unknown.target, 'session')
  const empty = normalizeToastTarget({}, 'x')
  assert.equal(empty.kind, 'completed')
  assert.equal(empty.target, 'session')
  assert.equal(empty.sessionId, null)
  assert.deepEqual(empty.sessionIds, [])
})

test('registry resolves, drops and evicts by TTL and limit', () => {
  const registry = createToastRegistry({ limit: 2, ttlMs: 1000 })
  registry.remember({ kind: 'completed', sessionId: 's1' }, 'a', 0)
  registry.remember({ kind: 'completed', sessionId: 's2' }, 'b', 10)
  assert.equal(registry.size, 2)
  assert.equal(registry.resolve('a').sessionId, 's1')
  assert.equal(registry.resolve('missing'), null)

  registry.remember({ kind: 'completed', sessionId: 's3' }, 'c', 20)
  assert.equal(registry.size, 2, 'limit keeps the registry bounded')
  assert.equal(registry.resolve('a'), null, 'oldest entry is evicted first')

  registry.remember({ kind: 'completed', sessionId: 's4' }, 'd', 3000)
  assert.equal(registry.resolve('b'), null, 'entries older than TTL are pruned')
  assert.equal(registry.resolve('c'), null, 'the whole stale window is pruned')
  assert.equal(registry.size, 1)
  assert.equal(registry.resolve('d').sessionId, 's4')

  assert.equal(registry.drop('d'), true)
  assert.equal(registry.resolve('d'), null)
  registry.clear()
  assert.equal(registry.size, 0)
})
