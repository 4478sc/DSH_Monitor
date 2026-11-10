import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DANGER_MAX_USES_LIMIT,
  DEFAULT_GRANTS,
  effectiveGrants,
  normalizeGrants,
  readSettings,
  settingsFile,
  writeSettings,
} from '../lib/ledger/settings.js'

function dir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'grants-settings-'))
}

test('normalizeGrants fills defaults and caps dangerMaxUses at 5', () => {
  const base = normalizeGrants(undefined)
  assert.equal(base.enabled, false)
  assert.equal(base.dangerMaxUses, DEFAULT_GRANTS.dangerMaxUses)
  assert.equal(DANGER_MAX_USES_LIMIT, 5)

  assert.equal(normalizeGrants({ dangerMaxUses: 99 }).dangerMaxUses, 5)
  assert.equal(normalizeGrants({ dangerMaxUses: 0 }).dangerMaxUses, 1)
  assert.equal(normalizeGrants({ dangerMaxUses: 3 }).dangerMaxUses, 3)
  assert.equal(normalizeGrants({ ttlMs: 1 }).ttlMs, 60_000)
  assert.equal(normalizeGrants({ maxUses: 5000 }).maxUses, 1000)
  assert.deepEqual(normalizeGrants({ alwaysAsk: ['a', 2] }).alwaysAsk, ['a', '2'])
})

test('the settings file round-trips only explicit booleans', () => {
  const d = dir()
  assert.deepEqual(readSettings(d), { version: 1, sessionGrants: {} })

  writeSettings(d, { sessionGrants: { enabled: true } })
  assert.deepEqual(readSettings(d).sessionGrants, { enabled: true })
  assert.equal(fs.existsSync(settingsFile(d) + '.tmp'), false, 'atomic write leaves no temp file')

  // The retired per-tier switch must not survive a read or a write.
  writeSettings(d, { sessionGrants: { allowDangerFullAccess: true } })
  assert.deepEqual(readSettings(d).sessionGrants, { enabled: true })

  writeSettings(d, { sessionGrants: { enabled: false } })
  assert.deepEqual(readSettings(d).sessionGrants, { enabled: false })
})

test('a legacy settings file that still names the removed switch is ignored', () => {
  const d = dir()
  fs.writeFileSync(settingsFile(d), JSON.stringify({ version: 1, sessionGrants: { enabled: true, allowDangerFullAccess: false } }), 'utf8')
  assert.deepEqual(readSettings(d).sessionGrants, { enabled: true })
  assert.equal(effectiveGrants({}, d).enabled, true)
})

test('a corrupt settings file changes nothing', () => {
  const d = dir()
  fs.writeFileSync(settingsFile(d), '{not json', 'utf8')
  assert.deepEqual(readSettings(d), { version: 1, sessionGrants: {} })
  const effective = effectiveGrants({ enabled: true }, d)
  assert.equal(effective.enabled, true, 'falls back to the static config')
})

test('stored switches override the static config, per key', () => {
  const d = dir()
  const config = { enabled: false, maxUses: 7 }
  assert.equal(effectiveGrants(config, d).enabled, false)

  writeSettings(d, { sessionGrants: { enabled: true } })
  const enabled = effectiveGrants(config, d)
  assert.equal(enabled.enabled, true, 'UI turns it on without touching the config')
  assert.equal(enabled.maxUses, 7, 'untouched fields still come from the config')

  writeSettings(d, { sessionGrants: { enabled: false } })
  assert.equal(effectiveGrants({ enabled: true }, d).enabled, false,
    'the UI can also switch it back off against a static true')
})
