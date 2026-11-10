/**
 * Native toast host event parsing and the click queue.
 *
 * GTK and WPF write one JSON object per line on stdout. This module keeps the
 * bridge testable without spawning a window: parseHostEvent() normalizes the
 * line, and createClickQueue() deduplicates repeated card clicks while keeping
 * a bounded, sequence-numbered queue for the client to poll.
 */

/** Parse one native host stdout line. Returns null for noise or unusable ids. */
export function parseHostEvent(line) {
  let value
  try {
    value = JSON.parse(String(line))
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const type = typeof value.event === 'string' ? value.event : ''
  if (type === '') return null
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : null
  const reason = typeof value.reason === 'string' ? value.reason : undefined
  if ((type === 'clicked' || type === 'closed') && id === null) return null
  return { type, id, reason, raw: value }
}

/**
 * Bounded click queue with per-notification deduplication.
 * Clicking a card twice before it closes must not navigate twice.
 */
export function createClickQueue(options = {}) {
  const limit = Math.max(1, Number.isInteger(options.limit) ? options.limit : 64)
  const dedupeMs = Math.max(0, Number.isFinite(options.dedupeMs) ? options.dedupeMs : 500)
  const items = []
  const lastClickAt = new Map()
  let seq = 0

  function pruneDedupe(now) {
    if (lastClickAt.size <= Math.max(limit * 4, 256)) return
    for (const [id, at] of lastClickAt) {
      if (now - at > dedupeMs) lastClickAt.delete(id)
    }
  }

  return {
    push(event, now = Date.now()) {
      const id = typeof event?.id === 'string' && event.id.length > 0 ? event.id : null
      if (id === null) return null
      const at = Number.isFinite(now) ? now : Date.now()
      if (dedupeMs > 0) {
        const previous = lastClickAt.get(id)
        if (previous !== undefined && at - previous < dedupeMs) return null
      }
      lastClickAt.set(id, at)
      pruneDedupe(at)
      seq += 1
      const item = { seq, id, at }
      for (const key of ['sessionId', 'kind', 'target', 'sessionIds', 'interactionKey']) {
        if (event[key] !== undefined) item[key] = event[key]
      }
      items.push(item)
      while (items.length > limit) items.shift()
      return item
    },
    list(sinceSeq = 0) {
      const from = Number.isFinite(sinceSeq) ? sinceSeq : 0
      return items.filter((item) => item.seq > from)
    },
    ack(seqs) {
      if (!Array.isArray(seqs) || seqs.length === 0) return
      const acked = new Set(seqs.filter((value) => Number.isFinite(value)))
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (acked.has(items[index].seq)) items.splice(index, 1)
      }
    },
    clear() {
      items.length = 0
      lastClickAt.clear()
    },
    get seq() {
      return seq
    },
    get size() {
      return items.length
    },
  }
}
