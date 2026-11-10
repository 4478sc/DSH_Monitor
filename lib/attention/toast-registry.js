/**
 * Notification identity and target metadata for dsh-attention-toast.
 *
 * The native toast host only knows about an opaque id. Navigation (issue #1)
 * must never parse titles or bodies, so every show() call carries the session
 * (or session list) it belongs to. This module is the single place that
 * normalizes that contract and remembers it while the toast is on screen.
 */

export const TOAST_TARGETS = ['session', 'approval', 'question', 'summary']

/** Default target for a toast kind when the caller did not provide one. */
export function defaultTarget(kind) {
  if (kind === 'permission') return 'approval'
  if (kind === 'question') return 'question'
  if (kind === 'sidelinedone') return 'summary'
  return 'session'
}

function cleanId(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function cleanIds(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    const id = cleanId(item)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Normalize one show() payload into the target record stored by the host.
 *
 * @param {object} payload toast payload (id, kind, sessionId, sessionIds, ...)
 * @param {string} id stable notification id
 * @param {number} now timestamp used for TTL bookkeeping
 */
export function normalizeToastTarget(payload, id, now = Date.now()) {
  const value = payload !== null && typeof payload === 'object' ? payload : {}
  const sessionIds = cleanIds(value.sessionIds)
  const sessionId = cleanId(value.sessionId) ?? sessionIds[0] ?? null
  const kind = typeof value.kind === 'string' && value.kind.length > 0 ? value.kind : 'completed'
  const target = TOAST_TARGETS.includes(value.target) ? value.target : defaultTarget(kind)
  const interactionKey = cleanId(value.interactionKey)
  return {
    id: String(id),
    sessionId,
    kind,
    target,
    // A summary is defined by its list; ordinary toasts by their one session.
    sessionIds: sessionIds.length > 0 ? sessionIds : (sessionId === null ? [] : [sessionId]),
    interactionKey,
    at: Number.isFinite(now) ? now : Date.now(),
  }
}

/**
 * Bounded, TTL-aware id -> target registry.
 * The native host may be reused for a long time; old entries are pruned so a
 * closed toast cannot later navigate to a stale session.
 */
export function createToastRegistry(options = {}) {
  const limit = Math.max(1, Number.isInteger(options.limit) ? options.limit : 128)
  const ttlMs = Math.max(1000, Number.isFinite(options.ttlMs) ? options.ttlMs : 10 * 60 * 1000)
  const entries = new Map()

  function prune(now) {
    for (const [key, value] of entries) {
      if (now - value.at > ttlMs) entries.delete(key)
    }
    while (entries.size > limit) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    remember(payload, id, now = Date.now()) {
      const target = normalizeToastTarget(payload, id, now)
      entries.set(target.id, target)
      prune(now)
      return target
    },
    resolve(id) {
      return entries.get(String(id)) ?? null
    },
    drop(id) {
      return entries.delete(String(id))
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}
