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
  assert.deepEqual(mounted.tools.map((t) => t.name).sort(), ['approval_ledger_grants', 'approval_ledger_query', 'approval_ledger_stats'])
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
// ── session grants (Phase 1) ────────────────────────────────────────────────

/** A sandbox-escalation request shaped exactly like dsh-sandbox builds it. */
function escalation(callId, mode = 'workspace-write', justification = 'install dependencies', sessionId = 's1') {
  return {
    toolName: 'bash',
    callId,
    reason: 'escalate sandbox to ' + mode + ': ' + justification,
    agent: { session: { id: sessionId } },
  }
}

const GRANT_CONFIG = {
  enabled: true,
  ttlMs: 10 * 60 * 1000,
  maxUses: 3,
  allowDangerFullAccess: false,
}

test('a grant answers the second escalation without the answerer', async () => {
  const ledgerDir = makeLedgerDir()
  const mounted = mount({ mode: 'ledger', ledgerDir, sessionGrants: GRANT_CONFIG })
  let asked = 0
  const answer = () => { asked += 1; return 'allowed-once' }

  assert.equal(await waterfall(mounted, escalation('c1'), answer), 'allowed-once')
  assert.equal(asked, 1, 'the first escalation is a real question')
  assert.equal(await waterfall(mounted, escalation('c2'), answer), 'allowed-once')
  assert.equal(asked, 1, 'the second one is answered by the grant')

  const rows = readLedger(ledgerDir)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].source, 'manual')
  assert.equal(rows[0].sandboxMode, 'workspace-write')
  assert.equal(rows[1].source, 'session-grant')
  assert.equal(rows[1].decision, 'auto-allow')
  assert.equal(rows[1].grantKey, 's1::bash::workspace-write')
})

test('the pending "waiting for approval" card is withdrawn when a grant answers', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir(), sessionGrants: GRANT_CONFIG })
  const pending = () => mounted.provided.attentionToast.getApprovals(0, 0).pending.length
  // The pending queue is module state shared by every mount in this process,
  // so compare deltas instead of absolute counts.
  const before = pending()
  await waterfall(mounted, escalation('c1'), () => 'allowed-once')
  const afterManual = pending()
  await waterfall(mounted, escalation('c2'), () => 'allowed-once')
  const afterAuto = pending()
  assert.equal(afterManual, before + 1, 'a real question queues a card')
  assert.equal(afterAuto, afterManual, 'an auto-approved request must not add a pending card')
})

test('rejections never become grants', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir(), sessionGrants: GRANT_CONFIG })
  assert.equal(await waterfall(mounted, escalation('c1'), () => 'rejected'), 'rejected')
  let asked = 0
  assert.equal(await waterfall(mounted, escalation('c2'), () => { asked += 1; return 'rejected' }), 'rejected')
  assert.equal(asked, 1, 'still a question: nothing was approved')
})

test('a grant is per session, per tool and per sandbox mode', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir(), sessionGrants: GRANT_CONFIG })
  await waterfall(mounted, escalation('c1'), () => 'allowed-once')

  let asked = 0
  const answer = () => { asked += 1; return 'allowed-once' }
  await waterfall(mounted, escalation('c2', 'workspace-write', 'x', 'other-session'), answer)
  await waterfall(mounted, { ...escalation('c3'), toolName: 'pwsh' }, answer)
  await waterfall(mounted, escalation('c4', 'danger-full-access'), answer)
  assert.equal(asked, 3, 'session, tool and mode are all part of the key')
})

test('high-risk escalations always ask, even with a grant', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir(), sessionGrants: GRANT_CONFIG })
  await waterfall(mounted, escalation('c1'), () => 'allowed-once')
  let asked = 0
  const outcome = await waterfall(mounted, escalation('c2', 'workspace-write', 'rm -rf /tmp/x'), () => { asked += 1; return 'rejected' })
  assert.equal(outcome, 'rejected')
  assert.equal(asked, 1)
})

test('gate mode still wins over a grant', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir(), sessionGrants: GRANT_CONFIG })
  await waterfall(mounted, escalation('c1'), () => 'allowed-once')
  // Switch to gate on the same ledger by mounting again: the grant survives.
  const gateDir = mounted.ledgerDir
  const gate = mount({ mode: 'gate', ledgerDir: gateDir, sessionGrants: GRANT_CONFIG })
  let asked = 0
  const outcome = await waterfall(gate, escalation('c2', 'workspace-write', 'deploy with sudo'), () => { asked += 1; return 'allowed-once' })
  assert.equal(outcome, 'rejected')
  assert.equal(asked, 0)
})

test('alwaysAsk patterns and revocations both fall back to asking', async () => {
  const ledgerDir = makeLedgerDir()
  const mounted = mount({
    mode: 'ledger',
    ledgerDir,
    sessionGrants: { ...GRANT_CONFIG, alwaysAsk: ['kubectl delete'] },
  })
  await waterfall(mounted, escalation('c1'), () => 'allowed-once')
  let asked = 0
  const answer = () => { asked += 1; return 'allowed-once' }
  await waterfall(mounted, escalation('c2', 'workspace-write', 'kubectl delete ns prod'), answer)
  assert.equal(asked, 1, 'alwaysAsk beats the grant')

  const { revoke } = await import('../lib/ledger/grants.js')
  revoke(ledgerDir, 's1::bash::workspace-write', Date.now() + 1000)
  await waterfall(mounted, escalation('c3'), answer)
  assert.equal(asked, 2, 'a revocation beats the grant')

  // Approving the revoked key again is an explicit "remember it again".
  await waterfall(mounted, escalation('c4'), answer)
  assert.equal(asked, 2, 'the fresh approval cleared the revocation and re-armed the grant')
})

test('grants stay off unless enabled', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir() })
  await waterfall(mounted, escalation('c1'), () => 'allowed-once')
  let asked = 0
  await waterfall(mounted, escalation('c2'), () => { asked += 1; return 'allowed-once' })
  assert.equal(asked, 1)
})

test('the grants tool lists and revokes live grants', async () => {
  const mounted = mount({ mode: 'ledger', ledgerDir: makeLedgerDir(), sessionGrants: GRANT_CONFIG })
  const grantsTool = mounted.tools.find((tool) => tool.name === 'approval_ledger_grants')
  assert.ok(grantsTool, 'grants tool is registered')

  await waterfall(mounted, escalation('c1'), () => 'allowed-once')
  const listed = await grantsTool.execute({ action: 'list' })
  assert.match(listed, /s1/)
  assert.match(listed, /workspace-write/)
  assert.match(listed, /s1::bash::workspace-write/)

  const revoked = await grantsTool.execute({ action: 'revoke', sessionId: 's1', tool: 'bash', sandboxMode: 'workspace-write' })
  assert.match(revoked, /已撤销/)
  assert.match(await grantsTool.execute({}), /没有生效的会话授权/)

  let asked = 0
  await waterfall(mounted, escalation('c2'), () => { asked += 1; return 'allowed-once' })
  assert.equal(asked, 1, 'after a revoke the request is asked again')
})
