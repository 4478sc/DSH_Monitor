import test from 'node:test'
import assert from 'node:assert/strict'
import { createClickQueue, parseHostEvent } from '../lib/attention/host-events.js'

test('parseHostEvent normalizes clicked and closed lines', () => {
  assert.deepEqual(parseHostEvent('{"event":"clicked","id":"toast-1"}'), {
    type: 'clicked', id: 'toast-1', reason: undefined, raw: { event: 'clicked', id: 'toast-1' },
  })
  assert.deepEqual(parseHostEvent('{"event":"closed","id":"toast-1","reason":"dismiss"}'), {
    type: 'closed', id: 'toast-1', reason: 'dismiss', raw: { event: 'closed', id: 'toast-1', reason: 'dismiss' },
  })
  assert.equal(parseHostEvent('{"event":"clicked"}'), null, 'clicked without id is unusable')
  assert.equal(parseHostEvent('{"event":"closed"}'), null, 'closed without id is unusable')
  assert.equal(parseHostEvent('{"event":"ready","pid":7}').type, 'ready')
  assert.equal(parseHostEvent('not json'), null)
  assert.equal(parseHostEvent('[]'), null)
})

test('click queue deduplicates, bounds and acknowledges events', () => {
  const queue = createClickQueue({ limit: 2, dedupeMs: 500 })
  const first = queue.push({ id: 'a' }, 100)
  assert.equal(first.seq, 1)
  assert.equal(queue.push({ id: 'a' }, 300), null, 'same toast within dedupe window is ignored')
  const second = queue.push({ id: 'b' }, 700)
  assert.equal(second.seq, 2)
  const third = queue.push({ id: 'c' }, 800)
  assert.equal(third.seq, 3)
  assert.deepEqual(queue.list(0).map((item) => item.id), ['b', 'c'], 'limit drops the oldest')
  assert.deepEqual(queue.list(2).map((item) => item.id), ['c'])
  assert.equal(queue.size, 2)
  queue.ack([second.seq])
  assert.deepEqual(queue.list(0).map((item) => item.id), ['c'])
  queue.clear()
  assert.equal(queue.size, 0)
  assert.deepEqual(queue.list(0), [])
})

test('closed lines never enter the click queue', () => {
  const queue = createClickQueue()
  const closed = parseHostEvent('{"event":"closed","id":"toast-1","reason":"dismiss"}')
  assert.equal(closed.type, 'closed')
  assert.equal(queue.size, 0, 'close button must not navigate')
})

test('click queue carries the session/target snapshot', () => {
  const queue = createClickQueue()
  const item = queue.push({
    id: 'toast-7',
    sessionId: 'session-a',
    kind: 'permission',
    target: 'approval',
    sessionIds: ['session-a'],
    interactionKey: 'approval:9',
  }, 100)
  assert.equal(item.sessionId, 'session-a')
  assert.equal(item.kind, 'permission')
  assert.equal(item.target, 'approval')
  assert.deepEqual(item.sessionIds, ['session-a'])
  assert.equal(item.interactionKey, 'approval:9')
  assert.equal(queue.list(0)[0].id, 'toast-7')
})
