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

// A real in-memory localStorage: the persistence test reads back what the
// plugin wrote, so a no-op stub would not prove anything.
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
}

// Pin the locale so the settings labels under test are deterministic. The
// host may ship its own navigator (Node >= 21), so keep a tolerant fallback.
let LOCALE_ZH = true
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true })
} catch {
  /* keep the host locale */
}
try {
  LOCALE_ZH = String(globalThis.navigator?.language || 'zh').toLowerCase().startsWith('zh')
} catch {
  LOCALE_ZH = true
}

const reactStub = {
  createElement: (type, props, ...kids) => ({ type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids }),
  useSyncExternalStore: (sub, get) => get(),
  useEffect: () => {},
  useState: () => [null, () => {}],
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  Fragment: 'Fragment',
}

let loadSerial = 0
async function loadClient() {
  loadSerial += 1
  await import(pathToFileURL(resolve('lib/client.js')).href + '?v=' + loadSerial)
  assert.ok(captured, 'client bundle must call __ModuleLoader__.load')
  const plugin = captured.factory((name) => {
    if (name === 'react') return reactStub
    throw new Error('unexpected require: ' + name)
  })
  assert.ok(plugin.__test, 'client must expose __test hooks')
  return plugin.__test
}

const api = await loadClient()

const STORAGE_KEY = 'dsh-attention-toast:config'
const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 0))

/** Session rows shaped like DSH's: origin/parentId are the real fields. */
function fixture() {
  return {
    root: { id: 'root', title: 'Root main', origin: 'main', running: false },
    tail: { id: 'tail', title: 'Tail main', origin: 'main', running: false },
    forkNoOrigin: { id: 'forkNoOrigin', title: 'Plain fork', running: false },
    forkMain: { id: 'forkMain', title: 'Forked main', origin: 'main', running: false },
    sub: { id: 'sub', title: 'Subagent', origin: 'subagent', parentId: 'root', running: false },
    sub2: { id: 'sub2', title: 'Subagent two', origin: 'subagent', parentId: 'root', running: false },
  }
}

const BASE_SETTINGS = {
  enabled: true,
  approvalToasts: true,
  notifySubagents: true,
  mainlineMode: 'mainline',
  currentSessionMode: 'always',
  waitForSubagents: false,
  mainlineSessionIds: [],
  mutedSessionIds: [],
  types: { completed: true, failed: true, question: true, permission: true },
}

function resetSettings(patch) {
  api.patchSettings({ ...BASE_SETTINGS, ...(patch || {}) })
}

function fakeRemote() {
  const remote = { shown: [], show: (payload) => { remote.shown.push(payload); return { ok: true } } }
  return remote
}

/** Point the client at test rows and a capturing host, then reset settings. */
function setup(rows, patch) {
  const remote = fakeRemote()
  api.setRemoteApi(remote)
  api.setSessionsById(rows || fixture())
  resetSettings(patch)
  return remote
}

/** Engine built from the very ports the runtime uses. */
function makeEngine(rows, events) {
  const holder = { rows: rows || fixture() }
  const engine = new api.NotificationEngine(api.createEnginePorts({
    listOf: () => ({ byId: holder.rows }),
    emit: (event) => { events.push(event) },
    settle: () => Promise.resolve(),
  }))
  const off = api.watchEngineSettings(engine)
  return { engine, off, holder }
}

function summaryOf(events) {
  return events.filter((event) => event.kind === 'sidelinedone')
}

test('notifySubagents defaults on and only a boolean switches it off', () => {
  assert.equal(api.normalizeSettings({}).notifySubagents, true)
  assert.equal(api.normalizeSettings({ notifySubagents: true }).notifySubagents, true)
  assert.equal(api.normalizeSettings({ notifySubagents: false }).notifySubagents, false)
  assert.equal(api.normalizeSettings({ notifySubagents: 'false' }).notifySubagents, true)
  assert.equal(api.getSettings().notifySubagents, true)
})

test('the switch persists in dsh-attention-toast:config and survives a fresh load', async () => {
  try {
    api.patchSettings({ notifySubagents: false, waitForSubagents: false })
    const stored = JSON.parse(store.get(STORAGE_KEY))
    assert.equal(stored.notifySubagents, false, 'patched value is written to the whitelist key')
    assert.equal(api.getSettings().notifySubagents, false)
    assert.equal(api.normalizeSettings(stored).notifySubagents, false)

    const fresh = await loadClient()
    assert.equal(fresh.getSettings().notifySubagents, false, 'a fresh page load reads the stored switch')
    assert.equal(fresh.getSettings().waitForSubagents, false, 'other client switches still come along')
  } finally {
    api.patchSettings({ notifySubagents: true, waitForSubagents: false })
  }
})

test('a silenced subagent shows no completion or failure toast', () => {
  const remote = setup()
  api.patchSettings({ notifySubagents: false })
  assert.equal(api.deliver({ kind: 'completed', sessionId: 'sub', title: 'Subagent', detail: 'done' }), false)
  assert.equal(api.deliver({ kind: 'failed', sessionId: 'sub', title: 'Subagent', detail: 'boom' }), false)
  assert.equal(remote.shown.length, 0)

  api.patchSettings({ notifySubagents: true })
  assert.equal(api.deliver({ kind: 'completed', sessionId: 'sub', title: 'Subagent', detail: 'done' }), true)
  assert.equal(remote.shown.length, 1)
  assert.equal(remote.shown[0].sessionId, 'sub')
  assert.equal(remote.shown[0].kind, 'completed')
})

test('parent sessions and plain forks keep alerting while subagents are silent', () => {
  const remote = setup()
  api.patchSettings({ notifySubagents: false })
  assert.equal(api.deliver({ kind: 'completed', sessionId: 'root', title: 'Root main' }), true)
  assert.equal(api.deliver({ kind: 'failed', sessionId: 'forkNoOrigin', title: 'Plain fork' }), true)
  assert.equal(api.deliver({ kind: 'completed', sessionId: 'forkMain', title: 'Forked main' }), true)
  assert.equal(api.deliver({ kind: 'completed', sessionId: 'sub2', title: 'Subagent two' }), false)
  assert.deepEqual(remote.shown.map((payload) => payload.sessionId), ['root', 'forkNoOrigin', 'forkMain'])
})

test('the subagent gate follows origin, not parentId or title', () => {
  const byId = fixture()
  assert.equal(api.isSubagentSession('sub', byId), true)
  assert.equal(api.isSubagentSession('root', byId), false)
  assert.equal(api.isSubagentSession('forkNoOrigin', byId), false)
  assert.equal(api.isSubagentSession('missing', byId), false)
  assert.equal(api.isSubagentSession(null, byId), false)
  assert.equal(api.isSubagentSession('sub', null), false)
  // A row that merely has a parentId (e.g. a fork of a session) is not a subagent.
  assert.equal(api.isSubagentSession('forkMain', { forkMain: { id: 'forkMain', parentId: 'root' } }), false)
  assert.equal(api.subagentSilent('sub', byId, false), true)
  assert.equal(api.subagentSilent('sub', byId, true), false)
  assert.equal(api.subagentSilent('root', byId, false), false)
})

test('a silenced subagent approval request never reaches the host', () => {
  const remote = setup()
  api.patchSettings({ notifySubagents: false })
  assert.equal(api.toastPendingApproval({ seq: 1, tool: 'bash', reason: 'rm -rf build', risk: 'high', sessionId: 'sub' }), null)
  assert.equal(remote.shown.length, 0)

  const parent = api.toastPendingApproval({ seq: 2, tool: 'bash', reason: 'rm -rf build', risk: 'high', sessionId: 'root' })
  assert.ok(parent, 'the parent session still gets its approval card')
  assert.equal(remote.shown.length, 1)
  assert.equal(remote.shown[0].kind, 'permission')
  assert.equal(remote.shown[0].sessionId, 'root')
})

test('a subagent-only summary is dropped; a mixed one keeps the root session', () => {
  const remote = setup()
  api.patchSettings({ notifySubagents: false })
  assert.equal(api.deliver({
    id: 'summary:1', kind: 'sidelinedone', sessionId: 'sub', sessionIds: ['sub'], detail: '1 个后台会话已空闲',
  }), false)
  assert.equal(remote.shown.length, 0, 'nothing to report when only subagents finished')

  assert.equal(api.deliver({
    id: 'summary:2', kind: 'sidelinedone', sessionId: 'root', sessionIds: ['root', 'sub'], detail: '2 个后台会话已空闲',
  }), true)
  assert.equal(remote.shown.length, 1)
  assert.deepEqual(remote.shown[0].sessionIds, ['root'])
  assert.equal(remote.shown[0].sessionId, 'root')
  assert.deepEqual(api.filterNotifiedSessionIds(['root', 'sub', 'sub2'], fixture(), false), ['root'])
  assert.deepEqual(api.filterNotifiedSessionIds(['root', 'sub'], fixture(), true), ['root', 'sub'])
})

test('the settings page shows the subagent switch inside the task-priority block', () => {
  resetSettings()
  const tree = api.SettingsSection()
  const blocks = tree.kids.map((kid) => (kid && kid.props ? kid.props.className : ''))
  assert.deepEqual(blocks, ['att-hero', 'att-block', 'att-block', 'att-block', 'att-block', 'att-block', 'att-block', 'att-foot'],
    'no new block is added for the subagent switch')
  const labels = {
    mode: LOCALE_ZH ? '任务模式' : 'Task mode',
    wait: LOCALE_ZH ? '等待子智能体' : 'Wait for subagents',
    subagent: LOCALE_ZH ? '子代理提醒' : 'Subagent alerts',
  }
  const priority = tree.kids[2]
  assert.equal(priority.props.className, 'att-block')
  assert.deepEqual(priority.kids.map((kid) => (kid && kid.props ? kid.props.label : undefined)),
    [undefined, labels.mode, labels.wait, labels.subagent])

  const row = priority.kids[3]
  assert.match(row.props.hint, /(完成|completion)/)
  assert.match(row.props.hint, /(父会话|Parent sessions)/)
  assert.match(row.props.hint, /(等待子智能|Wait for subagents)/)
  const toggle = row.kids[0]
  assert.equal(toggle.type, 'Switch')
  assert.equal(toggle.props.on, true, 'defaults on')
  toggle.props.onChange(false)
  assert.equal(api.getSettings().notifySubagents, false, 'the switch writes the real setting')
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).notifySubagents, false)
  api.patchSettings({ notifySubagents: true })
})

test('the engine emits no question for a silenced subagent and replays nothing when re-enabled', async () => {
  resetSettings({ mainlineMode: 'balanced' })
  const events = []
  const { engine, off } = makeEngine(fixture(), events)
  try {
    api.patchSettings({ notifySubagents: false })
    const question = new Map([['sub', { key: 'q1', kind: 'question', detail: 'pick one' }]])
    engine.observePending(question)
    assert.equal(events.length, 0, 'a silenced subagent question stays silent')

    api.patchSettings({ notifySubagents: true })
    assert.equal(events.length, 0, 'turning the switch back on does not replay it')
    engine.observePending(question)
    assert.equal(events.length, 0, 'the swallowed interaction is still the same key')

    // A genuinely new parent question still fires.
    engine.observePending(new Map([['root', { key: 'q1', kind: 'question', detail: 'pick one' }]]))
    assert.equal(events.length, 1)
    assert.equal(events[0].kind, 'question')
    assert.equal(events[0].sessionId, 'root')
  } finally {
    off()
  }
})

test('a subagent-only side-line wave pops no summary at all', async () => {
  resetSettings({ mainlineMode: 'mainline' })
  const rows = {
    sub: { id: 'sub', title: 'Sub', origin: 'subagent', parentId: 'root', running: true },
    sub2: { id: 'sub2', title: 'Sub 2', origin: 'subagent', parentId: 'root', running: true },
  }
  const events = []
  const { engine, off } = makeEngine(rows, events)
  try {
    api.patchSettings({ notifySubagents: false })
    engine.seed({ byId: rows })
    engine.observeStatus('sub', false)
    await tick()
    engine.observeStatus('sub2', false)
    await tick()
    assert.equal(events.length, 0, 'neither a completed toast nor a summary')
    assert.equal(summaryOf(events).length, 0)
  } finally {
    off()
  }
})

test('a mixed side-line wave still reports the root sessions', async () => {
  resetSettings({ mainlineMode: 'mainline' })
  const rows = {
    root: { id: 'root', title: 'Root', origin: 'main', running: true },
    sub: { id: 'sub', title: 'Sub', origin: 'subagent', parentId: 'root', running: true },
    tail: { id: 'tail', title: 'Tail', origin: 'main', running: true },
  }
  const events = []
  const { engine, off } = makeEngine(rows, events)
  try {
    api.patchSettings({ notifySubagents: false })
    engine.seed({ byId: rows })
    engine.observeStatus('root', false)
    await tick()
    engine.observeStatus('sub', false)
    await tick()
    engine.observeStatus('tail', false)
    await tick()
    const summaries = summaryOf(events)
    assert.equal(summaries.length, 1, 'one summary for the wave')
    assert.deepEqual(summaries[0].sessionIds, ['root', 'tail'])
    assert.equal(events.some((event) => event.sessionId === 'sub'), false)
  } finally {
    off()
  }
})

test('turning the switch off clears an already-pooled subagent instead of popping it later', async () => {
  resetSettings({ mainlineMode: 'mainline' })
  const rows = {
    sub: { id: 'sub', title: 'Sub', origin: 'subagent', parentId: 'root', running: true },
    sub2: { id: 'sub2', title: 'Sub 2', origin: 'subagent', parentId: 'root', running: true },
  }
  const events = []
  const { engine, off } = makeEngine(rows, events)
  try {
    api.patchSettings({ notifySubagents: true })
    engine.seed({ byId: rows })
    engine.observeStatus('sub', false)
    await tick()
    assert.equal(events.length, 0, 'pooled, waiting for the wave to finish')

    // Switch off while the entry sits in the side-line pool.
    api.patchSettings({ notifySubagents: false })
    engine.observeStatus('sub2', false)
    await tick()
    assert.equal(events.length, 0, 'the stale pool entry must not surface later')
    assert.equal(summaryOf(events).length, 0)
  } finally {
    off()
  }
})

test('turning the switch off drops a subagent event already deferred by "Wait for subagents"', async () => {
  resetSettings({ mainlineMode: 'balanced', waitForSubagents: true })
  const rows = {
    sub: { id: 'sub', title: 'Sub', origin: 'subagent', parentId: 'root', running: true },
    grandchild: { id: 'grandchild', title: 'Grandchild', origin: 'subagent', parentId: 'sub', running: true },
  }
  const events = []
  const { engine, off } = makeEngine(rows, events)
  try {
    engine.seed({ byId: rows })
    engine.observeStatus('sub', false)
    await tick()
    assert.equal(events.length, 0, 'deferred while its child still runs')

    api.patchSettings({ notifySubagents: false })
    rows.grandchild.running = false
    engine.observeStatus('grandchild', false)
    await tick()
    assert.equal(events.length, 0, 'the deferred subagent event must not be flushed')
  } finally {
    off()
  }
})

test('a parent alert still waits for running subagent children, and waitForSubagents stays independent', async () => {
  resetSettings({ mainlineMode: 'balanced', waitForSubagents: true })
  const rows = {
    root: { id: 'root', title: 'Root', origin: 'main', running: true },
    sub: { id: 'sub', title: 'Sub', origin: 'subagent', parentId: 'root', running: true },
  }
  const events = []
  const { engine, off } = makeEngine(rows, events)
  try {
    api.patchSettings({ notifySubagents: false })
    engine.seed({ byId: rows })
    engine.observeStatus('root', false)
    await tick()
    assert.equal(events.length, 0, 'the parent is held back by its running child')

    rows.sub.running = false
    engine.observeStatus('sub', false)
    await tick()
    assert.equal(events.length, 1, 'the parent still gets its own alert, and only that')
    assert.equal(events[0].sessionId, 'root')
    assert.equal(events[0].kind, 'completed')
  } finally {
    off()
  }
})

test('countRunningChildren reads the real parentId field and the legacy spelling', () => {
  const rows = [
    { id: 'c1', parentId: 'p', running: true },
    { id: 'c2', parentId: 'p', running: false },
    { id: 'c3', parentSessionId: 'p', running: true },
    { id: 'c4', parentId: 'q', running: true },
    null,
  ]
  assert.equal(api.countRunningChildren('p', rows), 2)
  assert.equal(api.countRunningChildren('q', rows), 1)
  assert.equal(api.countRunningChildren('z', rows), 0)
  assert.equal(api.countRunningChildren('p', []), 0)
})

test('observeAdded accepts both the id and the host sessionId payloads', async () => {
  resetSettings({ mainlineMode: 'balanced' })
  const events = []
  const rows = fixture()
  const { engine, off } = makeEngine(rows, events)
  try {
    engine.observeAdded({ sessionId: 'new1', running: true })
    engine.observeStatus('new1', false)
    await tick()
    engine.observeAdded({ id: 'new2', running: true })
    engine.observeStatus('new2', false)
    await tick()
    assert.deepEqual(events.map((event) => event.sessionId), ['new1', 'new2'])
  } finally {
    off()
  }
})
