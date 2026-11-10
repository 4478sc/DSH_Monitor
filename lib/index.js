/**
 * dsh-approval-toast — composed entry point.
 *
 * One plugin, one install: the approval ledger (records every approval, risk
 * scale, gate/auto modes, query tools, audit dashboard) and the desktop toast
 * half (attention notifications, settings page, click-to-navigate) used to be
 * two packages mounted side by side:
 *
 *   @deepwhale-cn/dsh-approval-ledger  (this repository before the merge)
 *   dsh-attention-toast                (4478sc/DSH_AttentionPlugins_Desktop)
 *
 * They already shared one artefact — the JSONL ledger — so this entry mounts
 * both halves into a single cordis plugin:
 *
 *   - the attention half registers its `approval/request` observer first, so a
 *     pending pre-approval toast is queued even when the ledger half rejects
 *     the request in `gate` mode;
 *   - the ledger half keeps the waterfall intact (it only ever returns a
 *     decision the user configured) and appends the record;
 *   - the ledger's risk classifier is handed to the attention half, so the
 *     "risk: high (advisory)" badge on a toast and the risk stored in
 *     `ledger.jsonl` are computed by one implementation;
 *   - the ledger half can answer an escalation from a session grant (see
 *     `lib/ledger/grants.js`); when it does, it tells the attention half to
 *     withdraw the pending card it queued microseconds earlier.
 *
 * @module dsh-approval-toast
 */

import { apply as applyAttention } from './attention/index.js'
import { apply as applyLedger, classifyRisk, DEFAULT_CONFIG, resolveLedgerDir } from './ledger/index.js'

export const name = 'approval-toast'
/** The ledger half registers two tools; the attention half needs no service. */
export const inject = ['tools']

/** Read the deny patterns the merged config would use for the toast hint. */
function denyPatternsOf(config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  return Array.isArray(value.denyPatterns) ? value.denyPatterns.map(String) : []
}

export function apply(ctx, config) {
  const denyPatterns = denyPatternsOf(config)
  const attentionOptions = {
    classify: (tool, reason) => classifyRisk({ toolName: tool, reason }, denyPatterns),
    // Both halves must agree on where <ledgerDir>/settings.json lives: the
    // settings page writes it, the approval hook reads it.
    ledgerDir: resolveLedgerDir(config),
    grantsConfig: config?.sessionGrants,
  }
  // Headless embedding (tests, containers without a display) can keep the
  // ledger half without launching a toast host: `toast: { spawn: false }`.
  if (config?.toast?.spawn === false) attentionOptions.spawn = false

  // Attention half first: its `approval/request` observer must see the request
  // before the ledger half can answer `rejected` from `gate` mode.
  const attention = applyAttention(ctx, attentionOptions)

  applyLedger(ctx, config, {
    // An escalation answered by a session grant must not leave a "waiting for
    // approval" card behind: the attention half queued one a moment earlier.
    onAutoApproved: (request) => {
      try {
        attention?.dropPending?.(request?.callId)
      } catch {
        /* a stale pending entry is cosmetic; never break the waterfall */
      }
    },
  })
}

/** Re-exported so embedders and tests can reason about the merged surface. */
export { classifyRisk, DEFAULT_CONFIG }
export { predictRisk as predictToastRisk } from './attention/ledger-reader.js'
