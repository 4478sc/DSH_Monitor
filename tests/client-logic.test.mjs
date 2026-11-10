import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// The browser bundle wraps itself in window.__ModuleLoader__.load(); stub the
// loader and a minimal React so the factory can be evaluated in Node.
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (mod) => { captured = mod } },
}
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
assert.ok(captured, 'client bundle must call __ModuleLoader__.load')
const plugin = captured.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected require: ' + name)
})
const api = plugin.__test
assert.ok(api, 'client must expose __test hooks')

test('migrates the old taskMode + sidelineMode pair', () => {
  assert.equal(api.normalizeSettings({ taskMode: 'mainline', sidelineMode: 'per-session' }).mainlineMode, 'balanced')
  assert.equal(api.normalizeSettings({ taskMode: 'mainline', sidelineMode: 'batch' }).mainlineMode, 'mainline')
  assert.equal(api.normalizeSettings({ taskMode: 'balanced', sidelineMode: 'batch' }).mainlineMode, 'balanced')
  assert.equal(api.normalizeSettings({ mainlineMode: 'silent' }).mainlineMode, 'silent')
  assert.equal(api.normalizeSettings({}).mainlineMode, 'mainline')
})

test('migrates notifyCurrent into currentSessionMode', () => {
  assert.equal(api.normalizeSettings({ notifyCurrent: true }).currentSessionMode, 'always')
  assert.equal(api.normalizeSettings({ notifyCurrent: false }).currentSessionMode, 'hidden')
  assert.equal(api.normalizeSettings({ currentSessionMode: 'unfocused' }).currentSessionMode, 'unfocused')
  assert.equal(api.normalizeSettings({ currentSessionMode: 'bogus' }).currentSessionMode, 'hidden')
})

test('sanitizes muted sessions and defaults waitForSubagents on', () => {
  const s = api.normalizeSettings({ mutedSessionIds: ['a', '', 3, 'b'] })
  assert.deepEqual(s.mutedSessionIds, ['a', 'b'])
  assert.equal(s.waitForSubagents, true)
  assert.equal(api.normalizeSettings({ waitForSubagents: false }).waitForSubagents, false)
})

test('decideAlert honours mode, marker and mute', () => {
  assert.equal(api.decideAlert('completed', 'mainline', false, false), 'aggregate')
  assert.equal(api.decideAlert('completed', 'mainline', true, false), 'alert')
  assert.equal(api.decideAlert('failed', 'mainline', false, false), 'aggregate')
  assert.equal(api.decideAlert('completed', 'balanced', false, false), 'alert')
  assert.equal(api.decideAlert('completed', 'silent', true, false), 'never')
  assert.equal(api.decideAlert('question', 'silent', false, false), 'alert')
  assert.equal(api.decideAlert('permission', 'silent', true, false), 'alert')
  assert.equal(api.decideAlert('completed', 'balanced', true, true), 'never')
  assert.equal(api.decideAlert('question', 'balanced', true, true), 'never')
})

test('shouldAlertCurrentSession covers the three tiers', () => {
  assert.equal(api.shouldAlertCurrentSession('hidden', { hidden: false, focused: true }), false)
  assert.equal(api.shouldAlertCurrentSession('hidden', { hidden: true, focused: false }), true)
  assert.equal(api.shouldAlertCurrentSession('unfocused', { hidden: false, focused: false }), true)
  assert.equal(api.shouldAlertCurrentSession('unfocused', { hidden: false, focused: true }), false)
  assert.equal(api.shouldAlertCurrentSession('always', { hidden: false, focused: true }), true)
})

test('countRunningChildren only counts running direct children', () => {
  const rows = [
    { parentSessionId: 'p', running: true },
    { parentSessionId: 'p', running: false },
    { parentSessionId: 'q', running: true },
  ]
  assert.equal(api.countRunningChildren('p', rows), 1)
  assert.equal(api.countRunningChildren('z', rows), 0)
})

test('settings section renders every block (root div stays open)', () => {
  const tree = api.SettingsSection()
  assert.equal(tree.props.className, 'att-root')
  const blocks = tree.kids.map((k) => (k && k.props ? k.props.className : ''))
  assert.deepEqual(blocks, ['att-hero', 'att-block', 'att-block', 'att-block', 'att-block', 'att-block', 'att-foot'])
  const eventsBlock = tree.kids[3]
  assert.equal(eventsBlock.kids.length, 2)
  assert.ok(Array.isArray(eventsBlock.kids[1]), 'events block renders one row per event type')
  assert.equal(eventsBlock.kids[1].length, 4)
  const lookBlock = tree.kids[4]
  assert.equal(lookBlock.kids.length, 4, 'appearance block: title + duration + max + current session')
})

test('builds only the pre-approval toast payload', () => {
  const pending = api.buildPendingToast({ seq: 1, tool: 'bash', reason: 'rm -rf build', risk: 'high', sessionId: 's1' }, 'Demo')
  assert.equal(pending.kind, 'permission')
  assert.ok(pending.kicker === '等待审批' || pending.kicker === 'Approval requested')
  assert.equal(pending.title, 'Demo')
  assert.match(pending.text, /bash/)
  assert.match(pending.text, /(本地预判|local prediction) high/)
  assert.equal(api.buildDecisionToast, undefined, 'the post-decision toast is removed')
})

test('the approvalToasts and permission switches gate the pending toast', () => {
  const pending = { seq: 5, tool: 'bash', reason: 'rm -rf build', risk: 'high', sessionId: 's1' }
  try {
    api.patchSettings({ approvalToasts: false })
    assert.equal(api.buildPendingToast(pending, 'Demo'), null)
    api.patchSettings({ approvalToasts: true })
    assert.ok(api.buildPendingToast(pending, 'Demo'))
    api.patchSettings({ types: { ...api.normalizeSettings({}).types, permission: false } })
    assert.equal(api.buildPendingToast(pending, 'Demo'), null)
  } finally {
    api.patchSettings({ approvalToasts: true, types: api.normalizeSettings({}).types })
  }
})

test('normalizes notification identity and navigation targets', () => {
  assert.equal(api.targetForKind('permission'), 'approval')
  assert.equal(api.targetForKind('question'), 'question')
  assert.equal(api.targetForKind('sidelinedone'), 'summary')
  assert.equal(api.targetForKind('completed'), 'session')

  const approval = api.normalizeToastPayload({
    kind: 'permission', title: 't', sessionId: 's1', interactionKey: 'approval:1',
  })
  assert.equal(approval.target, 'approval')
  assert.equal(approval.sessionId, 's1')
  assert.equal(approval.interactionKey, 'approval:1')
  assert.match(approval.id, /^s1:permission:\d+$/)

  const summary = api.normalizeToastPayload({
    id: 'summary:9', kind: 'sidelinedone', title: 't', sessionIds: ['a', 'b'],
  })
  assert.equal(summary.id, 'summary:9')
  assert.equal(summary.target, 'summary')
  assert.deepEqual(summary.sessionIds, ['a', 'b'])
  assert.equal(summary.sessionId, 'a')

  const single = api.normalizeToastPayload({ kind: 'sidelinedone', sessionId: 'solo', title: 't' })
  assert.deepEqual(single.sessionIds, ['solo'])
})

test('summary only lists aggregated side-line sessions, not the main-line one', async () => {
  const events = []
  const engine = new api.NotificationEngine({
    aggregateEnabled: () => true,
    alertAction: (kind, id) => (id === 'A' ? 'alert' : 'aggregate'),
    titleOf: (id) => 'S' + id,
    detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, finalText: '' }),
    runningChildren: () => 0,
    waitForSubagents: () => false,
    emit: (event) => events.push(event),
    settle: () => Promise.resolve(),
  })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  engine.seed({ byId: {
    A: { id: 'A', running: true },
    B: { id: 'B', running: true },
    C: { id: 'C', running: true },
  } })
  engine.observeStatus('B', false)
  await flush()
  engine.observeStatus('C', false)
  await flush()
  engine.observeStatus('A', false)
  await flush()

  const summary = events.find((event) => event.kind === 'sidelinedone')
  assert.ok(summary, 'side-line completion emits one summary')
  assert.deepEqual(summary.sessionIds, ['B', 'C'])
  assert.equal(summary.id, 'summary:1')
  assert.match(summary.detail, /2 个后台会话已空闲|2 background sessions are idle/)
  assert.ok(events.some((event) => event.kind === 'completed' && event.sessionId === 'A'))
})

test('summary includes the last side-line session when every session aggregates', async () => {
  const events = []
  const engine = new api.NotificationEngine({
    aggregateEnabled: () => true,
    alertAction: () => 'aggregate',
    titleOf: (id) => 'S' + id,
    detailOf: () => ({ maxTurnErrorSeq: 0, failureMessage: null, lastAgentError: null, finalText: '' }),
    runningChildren: () => 0,
    waitForSubagents: () => false,
    emit: (event) => events.push(event),
    settle: () => Promise.resolve(),
  })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  engine.seed({ byId: {
    A: { id: 'A', running: true },
    B: { id: 'B', running: true },
    C: { id: 'C', running: true },
  } })
  engine.observeStatus('B', false)
  await flush()
  engine.observeStatus('C', false)
  await flush()
  engine.observeStatus('A', false)
  await flush()

  const summary = events.find((event) => event.kind === 'sidelinedone')
  assert.ok(summary)
  assert.deepEqual([...summary.sessionIds].sort(), ['A', 'B', 'C'])
  assert.match(summary.detail, /3 个后台会话已空闲|3 background sessions are idle/)
})

test('resolveUiClick opens by session id, not by title', () => {
  const byId = {
    'session-a': { id: 'session-a', title: 'BetterProject' },
    'session-b': { id: 'session-b', title: 'BetterProject' },
  }
  assert.deepEqual(api.resolveUiClick({ sessionId: 'session-a', target: 'session' }, byId), { action: 'open', sessionId: 'session-a' })
  assert.deepEqual(api.resolveUiClick({ sessionId: 'session-b', target: 'session' }, byId), { action: 'open', sessionId: 'session-b' })
  assert.deepEqual(api.resolveUiClick({ sessionId: 'gone', target: 'session' }, byId), { action: 'missing', sessionId: 'gone' })
  assert.deepEqual(api.resolveUiClick({ sessionId: null, target: 'session' }, byId), { action: 'missing', sessionId: null })
  assert.deepEqual(api.resolveUiClick({ target: 'summary', sessionIds: ['session-a', 'session-b'] }, byId), { action: 'summary', sessionId: null })
})

test('pendingInteractionFor only focuses the current interaction', () => {
  const status = { pendingInteraction: { key: 'approval:1', kind: 'approval' } }
  assert.equal(api.pendingInteractionFor(status, 'approval:1').key, 'approval:1')
  assert.equal(api.pendingInteractionFor(status, 'approval:2'), null, 'a replaced approval must not be focused')
  assert.equal(api.pendingInteractionFor(status, '').key, 'approval:1')
  assert.equal(api.pendingInteractionFor({ pendingInteraction: null }, 'approval:1'), null)
  assert.equal(api.pendingInteractionFor(null, 'approval:1'), null)
})

test('buildSummaryItems lists every distinct session and disables deleted ones', () => {
  const byId = {
    a: { id: 'a', title: 'BetterProject' },
    b: { id: 'b', title: 'BetterProject' },
  }
  const items = api.buildSummaryItems(['a', 'b', 'gone', 'a'], byId)
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'gone'])
  assert.deepEqual(items.map((item) => item.exists), [true, true, false])
  assert.equal(items[0].title, 'BetterProject')
  assert.equal(items[1].title, 'BetterProject')
  assert.equal(items[2].title.length > 0, true)
  assert.deepEqual(api.buildSummaryItems([], byId), [])
  assert.deepEqual(api.buildSummaryItems(null, byId), [])
})

test('openSessionWith uses uiWorkspace.openSession', () => {
  const calls = []
  const workspace = { openSession: (id) => calls.push(id) }
  assert.equal(api.openSessionWith(workspace, 'session-a'), true)
  assert.deepEqual(calls, ['session-a'])
  assert.equal(api.openSessionWith({}, 'session-a'), false)
  assert.equal(api.openSessionWith(null, 'session-a'), false)
})

test('retainSession falls back to mainView retention', () => {
  const calls = []
  const reference = { ready: Promise.resolve(), release() {} }
  const sessions = { retain: (id, options) => { calls.push([id, options]); return reference } }
  assert.equal(api.retainSession(sessions, 'session-a'), reference)
  assert.deepEqual(calls, [['session-a', { source: 'mainView' }]])
  assert.throws(() => api.retainSession({}, 'session-a'))
  assert.throws(() => api.retainSession(null, 'session-a'))
})

test('predictRisk flags dangerous approval text and stays advisory for the rest', () => {
  assert.equal(api.predictRisk('escalate sandbox to danger-full-access: 验证'), 'high')
  assert.equal(api.predictRisk('bash: rm -rf build/'), 'high')
  assert.equal(api.predictRisk('chmod 777 /tmp/x'), 'high')
  assert.equal(api.predictRisk('删除 build 目录'), 'medium')
  assert.equal(api.predictRisk('list files'), 'low')
  assert.equal(api.predictRisk('   '), 'unknown')
})
