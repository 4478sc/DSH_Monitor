import test from 'node:test'
import assert from 'node:assert/strict'
import { TYPERT } from '../lib/typert.host.js'

test('typert manifest is owned by the package and exposes the host face', () => {
  assert.equal(TYPERT.package, 'dsh-approval-toast')
  assert.equal(TYPERT.face, 'host')
  assert.ok(Array.isArray(TYPERT.invocations) && TYPERT.invocations.length >= 5)
})

test('every invocation is a strict direct invocation of the attentionToast service', () => {
  const methods = new Set()
  for (const inv of TYPERT.invocations) {
    assert.equal(inv.service, 'attentionToast')
    assert.equal(inv.namespace, 'attentionToast')
    assert.equal(inv.invocation.kind, 'direct')
    assert.equal(inv.id, 'dsh-approval-toast#attentionToast/' + inv.method)
    assert.equal(inv.result.mode, 'strict')
    assert.equal(typeof inv.result.create, 'function')
    for (const p of inv.parameters) {
      assert.equal(p.source, 'json')
      assert.equal(p.codec.mode, 'strict')
      assert.equal(typeof p.codec.create, 'function')
    }
    methods.add(inv.method)
  }
  const declared = new Set(TYPERT.model.services[0].members.map((m) => m.name))
  assert.deepEqual([...methods].sort(), [...declared].sort())
})

test('show payload schema accepts the toast contract and rejects unknown kinds', () => {
  const inv = TYPERT.invocations.find((i) => i.method === 'show')
  const schema = inv.parameters[0].codec.schema
  const parsed = schema.parse({ kind: 'completed', title: 't', text: 'b', durationMs: 4000 })
  assert.equal(parsed.kind, 'completed')
  assert.throws(() => schema.parse({ kind: 'nope', title: 't' }))
})

test('show payload preserves the issue #1 session/target metadata', () => {
  const inv = TYPERT.invocations.find((i) => i.method === 'show')
  const schema = inv.parameters[0].codec.schema
  const payload = {
    kind: 'permission', title: 't', text: 'b',
    sessionId: 's1', target: 'approval', sessionIds: ['s1', 's2'], interactionKey: 'approval:3',
  }
  const parsed = schema.parse(payload)
  assert.equal(parsed.sessionId, 's1')
  assert.equal(parsed.target, 'approval')
  assert.deepEqual(parsed.sessionIds, ['s1', 's2'])
  assert.equal(parsed.interactionKey, 'approval:3')
  assert.throws(() => schema.parse({ kind: 'completed', title: 't', target: 'bogus' }))
})

test('ui event schema round-trips a click target', () => {
  const inv = TYPERT.invocations.find((i) => i.method === 'getUiEvents')
  const schema = inv.result.schema
  const value = {
    seq: 1,
    events: [{
      seq: 1, id: 'toast-1', sessionId: 's1', kind: 'completed',
      target: 'session', sessionIds: ['s1'], interactionKey: null, at: 123,
    }],
  }
  assert.deepEqual(schema.parse(value), value)
})

test('config schema round-trips the default desktop config', () => {
  const inv = TYPERT.invocations.find((i) => i.method === 'updateConfig')
  const schema = inv.result.schema
  const color = { bg: '#000000', fg: '#ffffff', accent: '#ff0000' }
  const cfg = {
    locale: 'zh', width: 340, durationMs: 8000, maxVisible: 3,
    colors: { completed: color, failed: color, question: color, permission: color, sidelinedone: color },
  }
  assert.deepEqual(schema.parse(cfg), cfg)
})
