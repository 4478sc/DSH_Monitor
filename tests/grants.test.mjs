import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearRevocation,
  escalationModeOf,
  grantBlockReason,
  grantKeyOf,
  grantUsage,
  isDestructive,
  parseGrantKey,
  readRevocations,
  revoke,
  revokedAtOf,
} from '../lib/ledger/grants.js'

const NOW = Date.parse('2026-11-10T12:05:00.000Z')
const BASE = {
  sessionId: 's1',
  tool: 'bash',
  sandboxMode: 'workspace-write',
  now: NOW,
  ttlMs: 30 * 60 * 1000,
  maxUses: 3,
}

/** One ledger row, shaped like lib/ledger/index.js writes it. */
function row(over = {}) {
  return {
    ts: '2026-11-10T12:00:00.000Z',
    sessionId: 's1',
    tool: 'bash',
    sandboxMode: 'workspace-write',
    decision: 'delegated',
    outcome: 'allowed-once',
    source: 'manual',
    ...over,
  }
}

test('escalationModeOf reads the dsh-sandbox reason format', () => {
  assert.equal(escalationModeOf({ reason: 'escalate sandbox to workspace-write: need npm install' }), 'workspace-write')
  assert.equal(escalationModeOf({ reason: 'Escalate sandbox to danger-full-access: registry' }), 'danger-full-access')
  assert.equal(escalationModeOf({ reason: 'something else entirely' }), '')
  assert.equal(escalationModeOf({}), '')
  assert.equal(escalationModeOf(null), '')
})

test('grant keys round-trip and refuse incomplete parts', () => {
  const key = grantKeyOf({ sessionId: 's1', tool: 'bash', sandboxMode: 'workspace-write' })
  assert.equal(key, 's1::bash::workspace-write')
  assert.deepEqual(parseGrantKey(key), { sessionId: 's1', tool: 'bash', sandboxMode: 'workspace-write' })
  assert.equal(grantKeyOf({ sessionId: 's1', tool: 'bash' }), '')
  assert.equal(grantKeyOf({}), '')
  assert.equal(parseGrantKey('nope'), null)
})

test('a manual approval activates the key; expiry and use count close it', () => {
  assert.equal(grantUsage([], BASE).active, false)
  assert.equal(grantUsage([row({ decision: 'auto-deny', outcome: 'rejected' })], BASE).active, false)

  const active = grantUsage([row()], BASE)
  assert.equal(active.active, true)
  assert.equal(active.used, 0)
  assert.equal(active.remaining, 3)
  assert.equal(active.expiresAt, NOW - 5 * 60 * 1000 + BASE.ttlMs)

  const stale = grantUsage([row({ ts: '2026-11-10T10:00:00.000Z' })], BASE)
  assert.equal(stale.active, false)
  assert.equal(stale.expired, true)

  const spent = grantUsage([
    row(),
    row({ source: 'session-grant', decision: 'auto-allow' }),
    row({ source: 'session-grant', decision: 'auto-allow' }),
    row({ source: 'session-grant', decision: 'auto-allow' }),
  ], BASE)
  assert.equal(spent.used, 3)
  assert.equal(spent.exhausted, true)
  assert.equal(spent.active, false)
})

test('rows for another session, tool or mode never grant anything', () => {
  const records = [
    row({ sessionId: 's2' }),
    row({ tool: 'pwsh' }),
    row({ sandboxMode: 'danger-full-access' }),
  ]
  assert.equal(grantUsage(records, BASE).active, false)
})

test('rejections and allowlist approvals neither grant nor spend', () => {
  const records = [
    row({ decision: 'auto-allow', outcome: 'allowed-once', source: 'allowlist' }),
    row({ decision: 'delegated', outcome: 'rejected' }),
    row({ decision: 'auto-deny', outcome: 'rejected' }),
  ]
  const usage = grantUsage(records, BASE)
  assert.equal(usage.active, false)
  assert.equal(usage.used, 0)
})

test('a revocation kills the grant until the key is approved again', () => {
  const granted = row()
  const blocked = grantUsage([granted], { ...BASE, revoked: true })
  assert.equal(blocked.revoked, true)
  assert.equal(blocked.active, false)

  // Re-approving the key clears the revocation (the hook calls clearRevocation),
  // so the very next evaluation is live again.
  const cleared = grantUsage([granted], { ...BASE, revoked: false })
  assert.equal(cleared.revoked, false)
  assert.equal(cleared.active, true)
})

test('grants are blocked by high risk, danger-full-access and alwaysAsk', () => {
  const grants = { alwaysAsk: ['kubectl delete'] }
  const verdict = { sandboxMode: 'workspace-write' }
  assert.equal(grantBlockReason(grants, { toolName: 'bash', reason: 'x' }, verdict, { level: 'medium' }), '')
  assert.equal(grantBlockReason(grants, { toolName: 'bash', reason: 'x' }, verdict, { level: 'high' }), 'high-risk')
  // No per-tier switch anymore: a danger escalation is eligible like any other,
  // and the danger-level guards (destructive + cap) are separate.
  assert.equal(grantBlockReason(grants, { toolName: 'bash', reason: 'read the registry' }, { sandboxMode: 'danger-full-access' }, { level: 'low' }), '')
  assert.equal(grantBlockReason(grants, { toolName: 'bash', reason: 'kubectl delete ns prod' }, verdict, { level: 'medium' }), 'always-ask')
  assert.equal(grantBlockReason({ alwaysAsk: ['('] }, { toolName: 'bash', reason: 'x' }, verdict, { level: 'medium' }), '')
})

test('revocations persist atomically and survive a re-read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grants-'))
  assert.deepEqual(readRevocations(dir), { version: 1, revocations: [] })
  revoke(dir, 's1::bash::workspace-write', 1000)
  revoke(dir, 's1::pwsh::workspace-write', 2000)
  revoke(dir, 's1::bash::workspace-write', 3000)
  const state = readRevocations(dir)
  assert.equal(state.revocations.length, 2)
  assert.equal(revokedAtOf(state, 's1::bash::workspace-write'), 3000)
  assert.equal(revokedAtOf(state, 's1::bash::other'), null)
  assert.equal(fs.existsSync(path.join(dir, 'grants.json.tmp')), false, 'no temp file is left behind')

  assert.equal(clearRevocation(dir, 's1::bash::workspace-write'), true)
  assert.equal(clearRevocation(dir, 's1::bash::workspace-write'), false, 'second clear is a no-op')
  assert.equal(revokedAtOf(readRevocations(dir), 's1::bash::workspace-write'), null)
  assert.equal(readRevocations(dir).revocations.length, 1)
})
test('destructive detection is conservative and covers the usual spellings', () => {
  assert.equal(isDestructive({ toolName: 'bash', reason: 'escalate sandbox to danger-full-access: rm -rf /tmp/x' }), true)
  assert.equal(isDestructive({ toolName: 'bash', reason: 'delete the old build artifacts' }), true)
  assert.equal(isDestructive({ toolName: 'fs_delete', reason: 'clean up' }), true)
  assert.equal(isDestructive({ toolName: 'bash', reason: '删除临时目录' }), true)
  assert.equal(isDestructive({ toolName: 'bash', reason: 'git clean -fdx' }), true)
  assert.equal(isDestructive({ toolName: 'bash', reason: 'run the test suite' }), false)
  assert.equal(isDestructive({ toolName: 'pwsh', reason: 'install dependencies' }), false)
  assert.equal(isDestructive({}), false)
})

test('a destructive danger-full-access request is never answered by a grant', () => {
  const permissive = { alwaysAsk: [] }
  const verdict = { sandboxMode: 'danger-full-access' }
  assert.equal(grantBlockReason(permissive, { toolName: 'bash', reason: 'rm -rf ~/Downloads/x' }, verdict, { level: 'low' }), 'destructive')
  assert.equal(grantBlockReason(permissive, { toolName: 'bash', reason: 'write outside the workspace' }, verdict, { level: 'low' }), '')
  // workspace-write deletions are governed by the risk rules, not by this veto
  assert.equal(grantBlockReason(permissive, { toolName: 'bash', reason: 'rm build/out.log' }, { sandboxMode: 'workspace-write' }, { level: 'medium' }), '')
})
