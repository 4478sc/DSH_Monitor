import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The attention half resolves DSH_HOME at module load, so point it at a
// throwaway directory before importing the composed entry point.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-toast-home-'))
process.env.DSH_HOME = home

const { apply, name, inject } = await import('../lib/index.js')

function makeLedgerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'approval-toast-ledger-'))
}

/** Mount the composed plugin on the smallest ctx both halves need. */
function mount(config = {}) {
  const handlers = []
  const tools = []
  const routes = []
  const provided = {}
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  const ctx = {
    on(event, fn) { handlers.push({ event, fn }) },
    tools: { register(tool) { tools.push(tool) } },
    provide(key, value) { provided[key] = value },
    inject(deps, cb) {
      if (deps.includes('webServer')) cb({ webServer, effect: (fn) => { fn(); return () => {} } })
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  const ledgerDir = config.ledgerDir ?? makeLedgerDir()
  apply(ctx, { ledgerDir, toast: { spawn: false }, ...config })
  return { handlers, tools, routes, provided, ledgerDir }
}

/** Run the cordis waterfall the way the host does: each listener may call next(). */
function waterfall(mounted, request, answer = () => 'allowed-once') {
  const listeners = mounted.handlers.filter((h) => h.event === 'approval/request').map((h) => h.fn)
  const run = (index) => {
    if (index >= listeners.length) return Promise.resolve(answer())
    return listeners[index](request, () => run(index + 1))
  }
  return run(0)
}

function readLedger(dir) {
  const file = path.join(dir, 'ledger.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

test('the merged plugin exposes one entry point and one tool injection', () => {
  assert.equal(name, 'approval-toast')
  assert.deepEqual(inject, ['tools'])
})

test('one mount registers both halves', () => {
  const mounted = mount()
  const approvalHooks = mounted.handlers.filter((h) => h.event === 'approval/request')
  assert.equal(approvalHooks.length, 2, 'attention observer + ledger recorder')
  assert.deepEqual(mounted.tools.map((t) => t.name).sort(), ['approval_ledger_query', 'approval_ledger_stats'])
  assert.ok(mounted.provided.attentionToast, 'attentionToast service is provided')
  assert.equal(typeof mounted.provided.attentionToast.getApprovals, 'function')
  assert.ok(mounted.routes.some((r) => r.path === '/approval-ledger'), 'audit dashboard route is mounted')
  // The ledger file is touched on load so the toast settings panel can report
  // "connected" before the first approval (ported from ledger 0.2.9).
  assert.ok(fs.existsSync(path.join(mounted.ledgerDir, 'ledger.jsonl')), 'ledger file exists right after mount')
})

test('gate mode: the toast observer still sees the request the ledger rejects', async () => {
  const ledgerDir = makeLedgerDir()
  const mounted = mount({ mode: 'gate', ledgerDir })
  let delegated = false
  const outcome = await waterfall(
    mounted,
    { toolName: 'bash', reason: 'rm -rf /tmp/x', callId: 'c1' },
    () => { delegated = true; return 'allowed-once' },
  )
  assert.equal(outcome, 'rejected')
  assert.equal(delegated, false, 'gate mode must not reach the host answerers')

  const [record] = readLedger(ledgerDir)
  assert.equal(record.decision, 'auto-deny')
  assert.equal(record.outcome, 'rejected')
  assert.equal(record.risk, 'high')

  const pending = mounted.provided.attentionToast.getApprovals(0, 0).pending
  assert.ok(pending.length >= 1)
  assert.equal(pending.at(-1).tool, 'bash')
  assert.equal(pending.at(-1).risk, 'high', 'toast hint and ledger record share one risk scale')
})

test('ledger mode: records the delegated decision without changing it', async () => {
  const ledgerDir = makeLedgerDir()
  const mounted = mount({ mode: 'ledger', ledgerDir })
  const outcome = await waterfall(mounted, { toolName: 'fs_write', reason: 'write config', callId: 'c2' })
  assert.equal(outcome, 'allowed-once')
  const [record] = readLedger(ledgerDir)
  assert.equal(record.decision, 'delegated')
  assert.equal(record.outcome, 'allowed-once')
  assert.equal(record.risk, 'medium')
  const pending = mounted.provided.attentionToast.getApprovals(0, 0).pending
  // The pending queue is module state shared by every mount in this process.
  assert.equal(pending.at(-1).risk, record.risk)
})

test('auto mode: allowlisted tools skip the host answerers but are still recorded', async () => {
  const ledgerDir = makeLedgerDir()
  const mounted = mount({ mode: 'auto', allowlist: ['present'], ledgerDir })
  let delegated = false
  const outcome = await waterfall(mounted, { toolName: 'present', reason: 'show result' }, () => {
    delegated = true
    return 'rejected'
  })
  assert.equal(outcome, 'allowed-once')
  assert.equal(delegated, false)
  const [record] = readLedger(ledgerDir)
  assert.equal(record.decision, 'auto-allow')
  assert.equal(record.outcome, 'allowed-once')
})

test('custom deny patterns reach the toast hint through the merged classifier', async () => {
  const ledgerDir = makeLedgerDir()
  const mounted = mount({ mode: 'ledger', ledgerDir, denyPatterns: ['kubectl delete'] })
  await waterfall(mounted, { toolName: 'bash', reason: 'kubectl delete ns prod' })
  const pending = mounted.provided.attentionToast.getApprovals(0, 0).pending
  assert.equal(pending.at(-1).risk, 'high')
  assert.equal(readLedger(ledgerDir)[0].risk, 'high')
})
