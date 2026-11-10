import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClickQueue, toUiEvent } from '../lib/attention/host-events.js'

// ── the browser half, loaded the way the app loads it ───────────────────────
let captured = null
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
globalThis.document = { hidden: false, hasFocus: () => true }
globalThis.localStorage = { getItem: () => null, setItem: () => {} }
const reactStub = {
  createElement: (type, props, ...kids) => ({ type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids }),
  useSyncExternalStore: (sub, get) => get(),
  useEffect: () => {},
  useState: () => [null, () => {}],
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  Fragment: 'Fragment',
}
await import(pathToFileURL(resolve('lib/client.js')).href + '?t=' + Date.now())
const plugin = captured.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected require: ' + name)
})
const api = plugin.__test

/** A toast payload as the client hands it to the host. */
function toast(over = {}) {
  return {
    id: 'toast-1',
    kind: 'approval',
    target: 'approval',
    sessionId: 'session-a',
    sessionIds: ['session-a'],
    interactionKey: 'approval:1',
    ...over,
  }
}

const byId = {
  'session-a': { id: 'session-a', title: 'Same title' },
  'session-b': { id: 'session-b', title: 'Same title' },
}

// ── queue → wire → navigation, all three hops in one test ────────────────────

test('a double click collapses into one navigation event', () => {
  const queue = createClickQueue()
  assert.ok(queue.push(toast(), 1000), 'first click is queued')
  assert.equal(queue.push(toast(), 1100), null, 'the same id inside the dedupe window is dropped')
  assert.ok(queue.push(toast(), 2000), 'the same id is queued again after the dedupe window')

  const events = queue.list(0).map((item) => toUiEvent(item, 2000))
  assert.equal(events.length, 2)
  assert.deepEqual(Object.keys(events[0]).sort(), [
    'at', 'id', 'interactionKey', 'kind', 'seq', 'sessionId', 'sessionIds', 'target',
  ])
})

test('the wire event opens the session it names, never the title', () => {
  const queue = createClickQueue()
  queue.push(toast(), 1000)
  const [event] = queue.list(0).map((item) => toUiEvent(item))
  assert.deepEqual(api.resolveUiClick(event, byId), { action: 'open', sessionId: 'session-a' })
})

test('a click for a session that is gone degrades to "missing"', () => {
  const queue = createClickQueue()
  queue.push(toast({ id: 'toast-gone', sessionId: 'session-gone', sessionIds: ['session-gone'] }), 1000)
  const [event] = queue.list(0).map((item) => toUiEvent(item))
  assert.deepEqual(api.resolveUiClick(event, byId), { action: 'missing', sessionId: 'session-gone' })
})

test('a summary toast always asks the picker, never picks a session', () => {
  const queue = createClickQueue()
  queue.push(toast({ id: 'toast-summary', kind: 'sidelinedone', target: 'summary', sessionId: null, sessionIds: ['session-a', 'session-gone'] }), 1000)
  const [event] = queue.list(0).map((item) => toUiEvent(item))
  assert.deepEqual(api.resolveUiClick(event, byId), { action: 'summary', sessionId: null })
  assert.deepEqual(api.buildSummaryItems(event.sessionIds, byId).map((i) => i.exists), [true, false])
})

test('the pending matcher focuses the matching key and refuses a replaced one', () => {
  const queue = createClickQueue()
  queue.push(toast(), 1000)
  const [event] = queue.list(0).map((item) => toUiEvent(item))
  const status = { pendingInteraction: { key: 'approval:1', kind: 'approval' } }
  assert.equal(api.pendingInteractionFor(status, event.interactionKey).key, 'approval:1')
  assert.equal(api.pendingInteractionFor(status, 'approval:2'), null, 'a replaced interaction is not focused')
  assert.equal(api.interactionIsGone(status, event.interactionKey), false)
  assert.equal(api.interactionIsGone({ pendingInteraction: null }, event.interactionKey), true,
    'nothing waiting any more: the caller must say so instead of focusing a stale card')
})

test('clicks queued before the app mounted are delivered once, then acked', () => {
  const queue = createClickQueue()
  queue.push(toast({ id: 'boot-1', sessionId: 'session-a' }), 1000)
  queue.push(toast({ id: 'boot-2', sessionId: 'session-b' }), 1001)

  const firstPoll = queue.list(0).map((item) => toUiEvent(item))
  assert.equal(firstPoll.length, 2, 'both clicks survived the boot gap')
  assert.deepEqual(firstPoll.map((e) => api.resolveUiClick(e, byId).action), ['open', 'open'])

  queue.ack(firstPoll.map((event) => event.seq))
  assert.deepEqual(queue.list(0), [], 'an acked event is never delivered twice')
  assert.deepEqual(queue.list(firstPoll[1].seq), [], 'resuming from the last seq stays empty')
})

test('toUiEvent normalizes unknown targets and missing metadata', () => {
  const queue = createClickQueue()
  queue.push({ id: 'weird', sessionId: null, target: 'bogus', sessionIds: ['a'] }, 1)
  const [event] = queue.list(0).map((item) => toUiEvent(item, 5))
  assert.equal(event.target, 'session')
  assert.equal(event.sessionId, null)
  assert.equal(event.kind, 'completed')
  assert.equal(event.interactionKey, null)
  assert.equal(event.at, 1, 'the queue timestamp is preserved')

  const fallback = toUiEvent({ seq: 9, id: 'raw' }, 42)
  assert.equal(fallback.at, 42, 'a queue item without a timestamp falls back to the supplied clock')
})
