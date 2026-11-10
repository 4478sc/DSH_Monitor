/**
 * Read-only view over @deepwhale-cn/dsh-approval-ledger's JSONL file.
 *
 * We never import that plugin: if it is installed it appends one JSON object per
 * decided approval to `$DSH_HOME/approval-ledger/ledger.jsonl`, and this module
 * turns new lines into the small records the toast client understands. When the
 * file is missing every function degrades to an empty result.
 */

const DECISION_LABELS = {
  'allowed-once': 'approved',
  allow: 'approved',
  allowed: 'approved',
  approved: 'approved',
  'auto-allow': 'approved',
  rejected: 'rejected',
  'auto-deny': 'rejected',
  deny: 'rejected',
  denied: 'rejected',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  unavailable: 'other',
}

/** Map a ledger decision/result string onto approved / rejected / cancelled / other. */
export function decisionKind(value) {
  const key = String(value ?? '').trim().toLowerCase()
  return DECISION_LABELS[key] ?? (key === '' ? 'other' : 'other')
}

/** Tolerant projection of one ledger line; returns null for unusable rows. */
export function normalizeRecord(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const ts = typeof raw.ts === 'string' ? raw.ts : typeof raw.time === 'string' ? raw.time : ''
  const tool = String(raw.tool ?? raw.toolName ?? '')
  const risk = String(raw.risk ?? raw.riskLevel ?? 'unknown').toLowerCase()
  const decisionRaw = raw.decision ?? raw.result ?? raw.outcome ?? ''
  // Normal delegated approvals record decision="delegated" and put the real
  // verdict in outcome ("allowed-once" / "rejected"); auto modes record
  // auto-allow / auto-deny directly. Prefer outcome for classification.
  const outcomeRaw = raw.outcome ?? raw.result ?? raw.decision ?? ''
  const reason = String(raw.reason ?? raw.detail ?? '')
  const sessionId = raw.sessionId ?? raw.session ?? null
  if (ts === '' && tool === '' && String(decisionRaw) === '') return null
  return {
    ts,
    tool,
    risk,
    decision: String(decisionRaw),
    kind: decisionKind(outcomeRaw),
    reason: reason.slice(0, 240),
    sessionId: typeof sessionId === 'string' ? sessionId : null,
  }
}

/** Aggregate recent ledger records for the settings panel (last N in memory). */
export function summarizeItems(items) {
  const list = Array.isArray(items) ? items : []
  let high = 0
  let rejected = 0
  for (const item of list) {
    if (item?.risk === 'high') high += 1
    if (item?.kind === 'rejected') rejected += 1
  }
  return { total: list.length, high, rejected }
}

/** Parse a chunk of JSONL into normalized records (bad lines are skipped). */
export function parseChunk(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const record = normalizeRecord(parsed)
    if (record !== null) out.push(record)
  }
  return out
}

const RISK_HIGH = [
  /rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i,
  /\bmkfs(\.|\s|$)/i, /\bdd\s+if=/i,
  /curl[^\n|]*\|\s*(sh|bash|zsh)\b/i, /wget[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  /\bsudo\b|\bdoas\b/, /chmod\s+777/,
  /\/etc\/(passwd|shadow|sudoers)/, /\.ssh\/(id_|authorized_keys|config)/,
  /(id_rsa|id_ed25519|\.pem|\.p12)\b/i,
  /danger-full-access|dangerously-skip-permissions/i,
  />\s*\/dev\/(sd|disk)/, /\b(shutdown|reboot|halt)\b/,
]
const RISK_MEDIUM = [
  /\b(rm|rmdir|mv)\s/, /\b(chmod|chown)\s/,
  /\b(credential|secret|token|password|api[_-]?key)\b/i,
  /\b(delete|remove|overwrite|truncate)\b/i,
  /(删除|覆盖|清空|凭据|密钥|令牌|写入)/,
]

/** Heuristic risk prediction for approval text. Advisory only. */
export function predictRisk(text) {
  const value = String(text ?? '')
  for (const re of RISK_HIGH) if (re.test(value)) return 'high'
  for (const re of RISK_MEDIUM) if (re.test(value)) return 'medium'
  return value.trim() === '' ? 'unknown' : 'low'
}
