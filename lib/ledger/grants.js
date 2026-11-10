import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Session-scoped standing grants for sandbox escalations.
 *
 * Phase 1 of the "do not ask twice" idea: the user approves one escalation and
 * the same (session, tool, sandbox mode) triple is approved automatically
 * afterwards, until it expires, runs out of uses, or is revoked.
 *
 * Two deliberate limits:
 *
 *  - The approval waterfall carries no tool arguments (only `toolName`,
 *    `callId`, `reason`, `displayReason`, `signal`), so a grant can never key
 *    on the command or path. The narrowest stable key is the sandbox mode, which
 *    rides `reason` as `escalate sandbox to <mode>: <justification>`
 *    (see @deepseek-ai/dsh-sandbox approveEscalation).
 *  - The ledger is the grant store: every manual approval and every automatic
 *    one is already a row there, so "was this approved before?" is a query, not
 *    new state. Only revocations need their own file, because the ledger is
 *    append-only and deleting audit rows is not an option.
 *
 * @module approval-toast/grants
 */

/** `escalate sandbox to workspace-write: <justification>` → `workspace-write`. */
const ESCALATION_REASON = /^escalate sandbox to ([a-z][a-z-]*)\s*:/i;

/** Sandbox mode of an approval request, or '' when this is not an escalation. */
export function escalationModeOf(request) {
  const reason = typeof request?.reason === 'string' ? request.reason : '';
  const matched = ESCALATION_REASON.exec(reason);
  return matched === null ? '' : matched[1].toLowerCase();
}

/** Stable grant key: one session, one tool, one sandbox mode. */
export function grantKeyOf({ sessionId, tool, sandboxMode } = {}) {
  const session = typeof sessionId === 'string' ? sessionId : '';
  const name = typeof tool === 'string' ? tool : '';
  const mode = typeof sandboxMode === 'string' ? sandboxMode : '';
  if (session === '' || name === '' || mode === '') return '';
  return session + '::' + name + '::' + mode;
}

/** Inverse of {@link grantKeyOf}; null for keys this module did not produce. */
export function parseGrantKey(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split('::');
  if (parts.length !== 3 || parts.some((part) => part === '')) return null;
  return { sessionId: parts[0], tool: parts[1], sandboxMode: parts[2] };
}

/**
 * Replay the ledger's rows for one key.
 *
 * A `delegated` + `allowed-once` row is the grant ("the user said yes");
 * a `source: 'session-grant'` row is a use of it. Rejections, cancellations and
 * allowlist auto-approvals are ignored: they neither grant nor spend.
 *
 * @returns {{ active: boolean, grantedAt: number, used: number, remaining: number,
 *   expiresAt: number, expired: boolean, exhausted: boolean, revoked: boolean }}
 */
export function grantUsage(records, options = {}) {
  const { sessionId, tool, sandboxMode, now = Date.now(), ttlMs, maxUses, revoked = false } = options;
  const list = Array.isArray(records) ? records : [];
  let grantedAt = 0;
  let used = 0;
  for (const record of list) {
    if (record === null || typeof record !== 'object') continue;
    if (record.sessionId !== sessionId || record.tool !== tool || record.sandboxMode !== sandboxMode) continue;
    if (record.outcome !== 'allowed-once') continue;
    if (record.source === 'session-grant') {
      used += 1;
      continue;
    }
    if (record.decision !== 'delegated') continue;
    const at = Date.parse(record.ts);
    if (Number.isFinite(at) && at > grantedAt) grantedAt = at;
  }
  const expired = grantedAt === 0 || !Number.isFinite(ttlMs) || now - grantedAt > ttlMs;
  const exhausted = Number.isInteger(maxUses) && maxUses > 0 ? used >= maxUses : false;
  // Revocation is a fact about the key, not a timestamp comparison: two events
  // can share a millisecond, and a tie must not silently re-arm a grant the
  // user withdrew. Re-approving the key clears the revocation (clearRevocation).

  return {
    active: grantedAt > 0 && !expired && !exhausted && !revoked,
    grantedAt,
    used,
    remaining: Number.isInteger(maxUses) && maxUses > 0 ? Math.max(0, maxUses - used) : 0,
    expiresAt: grantedAt === 0 || !Number.isFinite(ttlMs) ? 0 : grantedAt + ttlMs,
    expired,
    exhausted,
    revoked: revoked === true,
  };
}

/** Why a request must still be asked despite a matching key; '' means "eligible". */
export function grantBlockReason(sessionGrants, request, verdict, risk) {
  if (risk?.level === 'high') return 'high-risk';
  if (verdict.sandboxMode === 'danger-full-access' && sessionGrants.allowDangerFullAccess !== true) {
    return 'danger-full-access';
  }
  const haystack = String(request?.toolName ?? '') + ' ' + String(request?.reason ?? '');
  for (const pattern of sessionGrants.alwaysAsk ?? []) {
    try {
      if (new RegExp(pattern, 'i').test(haystack)) return 'always-ask';
    } catch {
      /* an invalid user pattern must never block the ask path */
    }
  }
  return '';
}

/** `<ledgerDir>/grants.json` — the only state this feature stores. */
export function grantsFile(dir) {
  return dir + '/grants.json';
}

/** Read the revocation list; a missing or corrupt file means "nothing revoked". */
export function readRevocations(dir) {
  try {
    const raw = JSON.parse(readFileSync(grantsFile(dir), 'utf8'));
    const list = Array.isArray(raw?.revocations) ? raw.revocations : [];
    return {
      version: 1,
      revocations: list
        .filter((entry) => entry && typeof entry.key === 'string' && Number.isFinite(entry.at))
        .map((entry) => ({ key: entry.key, at: entry.at })),
    };
  } catch {
    return { version: 1, revocations: [] };
  }
}

/** Timestamp of the newest revocation for one key, or null. */
export function revokedAtOf(revocations, key) {
  let latest = null;
  for (const entry of revocations?.revocations ?? []) {
    if (entry.key !== key) continue;
    if (latest === null || entry.at > latest) latest = entry.at;
  }
  return latest;
}

/** Append one revocation, newest wins; the write is atomic (temp + rename). */
export function revoke(dir, key, now = Date.now()) {
  const state = readRevocations(dir);
  state.revocations = state.revocations.filter((entry) => entry.key !== key);
  state.revocations.push({ key, at: Number.isFinite(now) ? now : Date.now() });
  writeRevocations(dir, state);
  return state;
}

/**
 * Clear the revocation for one key — called when the user approves the same
 * key again, which is an explicit "remember it again".
 */
export function clearRevocation(dir, key) {
  const state = readRevocations(dir);
  const next = state.revocations.filter((entry) => entry.key !== key);
  if (next.length === state.revocations.length) return false;
  state.revocations = next;
  writeRevocations(dir, state);
  return true;
}

/** Drop all revocations (a fresh start for the whole directory). */
export function clearRevocations(dir) {
  const state = { version: 1, revocations: [] };
  writeRevocations(dir, state);
  return state;
}

function writeRevocations(dir, state) {
  const file = grantsFile(dir);
  const temp = file + '.tmp';
  mkdirSync(dir, { recursive: true });
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(temp, file);
}
