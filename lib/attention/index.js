/**
 * approval-toast — attention (desktop toast) host half.
 *
 * Merged from the standalone dsh-attention-toast plugin. Owns the desktop
 * toast process (Windows WPF / Linux GTK3) and exposes it to the browser half
 * through the Typert service `attentionToast`.
 *
 * The browser half decides *what* to show (main-line / side-line gating,
 * event switches); this half decides *how* it looks (colors, duration, stack).
 * Risk classification for pre-approval toasts is injected by the composed
 * entry point so it matches the approval ledger's record.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, openSync, readSync, closeSync, appendFileSync, copyFileSync } from 'node:fs'
import { parseChunk, predictRisk, summarizeItems } from './ledger-reader.js'
import { createToastRegistry } from './toast-registry.js'
import { createClickQueue, parseHostEvent, toUiEvent } from './host-events.js'
import { effectiveGrants, writeSettings } from '../ledger/settings.js'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'approval-toast:attention'
export const inject = []

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'toast_host.py')
const SCRIPT_WIN = join(HERE, 'toast_host.ps1')
const IS_WIN = process.platform === 'win32'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
/** Storage now belongs to the merged plugin. */
const STORAGE_DIR = join(DSH_HOME, 'storages', 'dsh-approval-toast')
/** Where the standalone dsh-attention-toast kept its settings. */
const LEGACY_STORAGE_DIR = join(DSH_HOME, 'storages', 'dsh-attention-toast')
const CONFIG_PATH = join(STORAGE_DIR, 'config.json')
const LEDGER_PATH = process.env.DSH_APPROVAL_LEDGER || join(DSH_HOME, 'approval-ledger', 'ledger.jsonl')
const LEDGER_TAIL_BYTES = 256 * 1024
const HOST_LOG = join(STORAGE_DIR, 'host.log')
/** `<ledgerDir>/settings.json` holds the two switches the settings page owns. */
const DEFAULT_GRANTS_DIR = join(DSH_HOME, 'approval-ledger')

/** Carry the standalone plugin's appearance settings over on first run. */
function adoptLegacyConfig() {
  try {
    if (existsSync(CONFIG_PATH)) return
    const legacy = join(LEGACY_STORAGE_DIR, 'config.json')
    if (!existsSync(legacy)) return
    mkdirSync(STORAGE_DIR, { recursive: true })
    copyFileSync(legacy, CONFIG_PATH)
  } catch {
    /* settings are cosmetic: never fail activation over them */
  }
}

/** Accept either a level string or a `{ level }` object from the injected classifier. */
function riskLevelOf(classify, tool, reason) {
  const verdict = classify(tool, reason)
  const level = typeof verdict === 'string' ? verdict : verdict?.level
  return typeof level === 'string' && level.length > 0 ? level : 'unknown'
}

function hostLog(message) {
  try {
    mkdirSync(dirname(HOST_LOG), { recursive: true })
    appendFileSync(HOST_LOG, new Date().toISOString() + ' ' + message + '\n')
  } catch { /* ignore */ }
}

/** Incremental, read-only reader for the optional approval ledger file. */
const ledgerState = { offset: 0, seq: 0, items: [], started: false, exists: false }
/** Avoid writing the whole ledger state to host.log on every 2.5 s poll. */
const ledgerLogState = { seq: -1, exists: null }
/** Approval requests seen before their decision; polled by the client to toast early. */
const pendingState = { seq: 0, items: [], byCallId: new Map() }

function refreshLedger() {
  let stat
  try { stat = statSync(LEDGER_PATH) } catch { return }
  ledgerState.exists = true
  if (!ledgerState.started) {
    ledgerState.started = true
    ledgerState.offset = stat.size > LEDGER_TAIL_BYTES ? stat.size - LEDGER_TAIL_BYTES : 0
  }
  if (stat.size < ledgerState.offset) {
    // The ledger was truncated or rotated: forget the old projection so the
    // next lines are read from the beginning instead of being skipped.
    ledgerState.offset = 0
    ledgerState.items = []
  }
  if (stat.size === ledgerState.offset) return
  let buffer
  try {
    const fd = openSync(LEDGER_PATH, 'r')
    const length = stat.size - ledgerState.offset
    buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, ledgerState.offset)
    closeSync(fd)
  } catch { return }
  ledgerState.offset = stat.size
  let text = buffer.toString('utf8')
  if (text.length > 0 && !text.startsWith('{') && text.indexOf('\n') > 0) text = text.slice(text.indexOf('\n') + 1)
  for (const record of parseChunk(text)) {
    ledgerState.seq += 1
    ledgerState.items.push({ seq: ledgerState.seq, ...record })
  }
  if (ledgerState.items.length > 200) ledgerState.items = ledgerState.items.slice(-200)
}

const DEFAULT_CONFIG = {
  locale: 'zh',
  width: 340,
  durationMs: 8000,
  maxVisible: 3,
  colors: {
    completed: { bg: '#12351f', fg: '#e6f4ea', accent: '#2ea043' },
    failed: { bg: '#3a1518', fg: '#fbe9ea', accent: '#d1242f' },
    question: { bg: '#241a3d', fg: '#efe9ff', accent: '#8250df' },
    permission: { bg: '#3a2a10', fg: '#fff4e0', accent: '#bf8700' },
    sidelinedone: { bg: '#0d2a33', fg: '#e3f6fb', accent: '#1f8fb0' },
  },
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Deep-merge a patch into the current config, keeping schema-known keys only. */
function mergeConfig(base, patch) {
  const next = clone(base)
  if (patch === null || typeof patch !== 'object') return next
  for (const key of ['locale', 'width', 'durationMs', 'maxVisible']) {
    if (patch[key] !== undefined && patch[key] !== null) next[key] = patch[key]
  }
  const colors = patch.colors
  if (colors !== null && typeof colors === 'object') {
    for (const kind of Object.keys(next.colors)) {
      const entry = colors[kind]
      if (entry === null || typeof entry !== 'object') continue
      for (const field of ['bg', 'fg', 'accent']) {
        if (typeof entry[field] === 'string' && entry[field].length > 0) next.colors[kind][field] = entry[field]
      }
    }
  }
  next.width = Math.min(520, Math.max(260, Number(next.width) || 340))
  next.durationMs = Math.min(60000, Math.max(2000, Number(next.durationMs) || 8000))
  next.maxVisible = Math.min(6, Math.max(1, Number(next.maxVisible) || 3))
  if (next.locale !== 'zh' && next.locale !== 'en') next.locale = 'zh'
  return next
}

function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return mergeConfig(DEFAULT_CONFIG, raw)
  } catch {
    return clone(DEFAULT_CONFIG)
  }
}

function saveConfig(config) {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')
  } catch (err) {
    console.warn('[attention-toast] cannot persist config:', err?.message ?? err)
  }
}

/** Locate the XWayland auth cookie; a System-D service does not export XAUTHORITY. */
function findXauthority() {
  if (process.env.XAUTHORITY && existsSync(process.env.XAUTHORITY)) return process.env.XAUTHORITY
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  try {
    const dir = '/run/user/' + uid
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.mutter-Xwaylandauth.')) return join(dir, name)
    }
  } catch {
    /* ignore */
  }
  const fallback = join(homedir(), '.Xauthority')
  return existsSync(fallback) ? fallback : undefined
}

export function apply(ctx, options = {}) {
  // `spawn: false` keeps the merge tests free of child processes; the composed
  // entry point never passes it.
  const spawnEnabled = options.spawn !== false
  // Risk scale is injected by the composed entry point so the pre-approval
  // toast and the ledger record always agree on high/medium/low.
  const riskOf = typeof options.classify === 'function'
    ? options.classify
    : (tool, reason) => ({ level: predictRisk(String(tool) + ' ' + String(reason)) })
  // Session-grant settings are shared with the ledger half, so the settings
  // page and the approval hook must point at the same directory.
  const grantsDir = typeof options.ledgerDir === 'string' && options.ledgerDir !== ''
    ? options.ledgerDir
    : DEFAULT_GRANTS_DIR
  const grantsConfig = options.grantsConfig !== null && typeof options.grantsConfig === 'object'
    ? options.grantsConfig
    : {}
  adoptLegacyConfig()
  hostLog('apply platform=' + process.platform + ' ledger=' + LEDGER_PATH + ' spawn=' + spawnEnabled)
  for (const candidate of [SCRIPT, join(HERE, '..', 'lib', 'toast_host.py')]) {
    if (existsSync(candidate)) {
      if (!existsSync(SCRIPT)) console.warn('[attention-toast] toast host script not at expected path, using', candidate)
    }
  }

  let config = loadConfig()
  let child = null
  let alive = false
  let buffer = ''
  let lastError = null
  let disposed = false
  let stderrTail = ''
  let anonymousToastSeq = 0
  // id -> session/target metadata. Native clicks only carry the opaque id, so
  // this is what lets the host tell the client which session to open.
  const toastRegistry = createToastRegistry()
  const clickQueue = createClickQueue()

  const emitLog = (line) => {
    const event = parseHostEvent(line)
    if (event === null) return
    if (event.type === 'ready') console.log('[attention-toast] toast host ready pid=' + event.raw.pid)
    else if (event.type === 'error') console.warn('[attention-toast] toast host error:', event.raw.message)
    else if (event.type === 'clicked') {
      const target = toastRegistry.resolve(event.id)
      if (target === null) {
        hostLog('clicked unknown id=' + event.id)
        return
      }
      const item = clickQueue.push({
        id: event.id,
        sessionId: target.sessionId,
        kind: target.kind,
        target: target.target,
        sessionIds: target.sessionIds,
        interactionKey: target.interactionKey,
      })
      if (item !== null) hostLog('clicked id=' + item.id + ' seq=' + item.seq)
    } else if (event.type === 'raise') {
      // "Did the click actually bring the window back" is the one thing that
      // cannot be reproduced off-machine, so it goes into the log verbatim.
      const payload = event.raw ?? {}
      const detail = Array.isArray(payload.log) ? ' log=' + payload.log.join(' | ') : ''
      hostLog('raise ok=' + (payload.ok === true) + ' hwnd=' + (payload.hwnd ?? '') + detail)
    } else if (event.type === 'closed') {
      // A closed toast can no longer be a navigation target.
      toastRegistry.drop(event.id)
    }
  }

  function stopHost() {
    // Every toast rendered by the old process is gone with it.
    toastRegistry.clear()
    clickQueue.clear()
    if (child !== null) {
      try {
        write('{"cmd":"shutdown"}\n')
        child.stdin.end()
      } catch {
        /* ignore */
      }
      const dying = child
      child = null
      alive = false
      setTimeout(() => {
        try { dying.kill('SIGTERM') } catch { /* ignore */ }
      }, 400)
    }
    alive = false
  }

  function write(line) {
    if (child === null) return false
    try {
      child.stdin.write(line)
      return true
    } catch (err) {
      lastError = err?.message ?? String(err)
      return false
    }
  }

  function spawnHost() {
    if (disposed || !spawnEnabled) return false
    if (child !== null) return true
    const env = { ...process.env }
    let command = process.env.DSH_TOAST_PYTHON || process.env.PYTHON || 'python3'
    let args = ['-u', SCRIPT]
    if (IS_WIN) {
      command = process.env.DSH_TOAST_POWERSHELL || 'powershell.exe'
      args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_WIN]
    } else {
      env.GDK_BACKEND = 'x11'
      env.DISPLAY = process.env.DISPLAY || ':0'
      env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || '/run/user/' + (typeof process.getuid === 'function' ? process.getuid() : 1000)
      const auth = findXauthority()
      if (auth !== undefined) env.XAUTHORITY = auth
      if (env.NO_AT_BRIDGE === undefined) env.NO_AT_BRIDGE = '1'
    }

    try {
      child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      lastError = err?.message ?? String(err)
      console.warn('[attention-toast] cannot spawn toast host:', lastError)
      child = null
      return false
    }

    const spawnedChild = child
    buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (child !== spawnedChild) return
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line !== '') emitLog(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-2000)
    })
    child.on('error', (err) => {
      if (child !== spawnedChild) return
      lastError = err?.message ?? String(err)
      alive = false
      console.warn('[attention-toast] toast host error:', lastError)
    })
    child.on('exit', (code, signal) => {
      if (child !== spawnedChild) return
      alive = false
      child = null
      toastRegistry.clear()
      clickQueue.clear()
      if (!disposed && code !== 0 && code !== null) {
        lastError = 'toast host exited code=' + code + (signal ? ' signal=' + signal : '')
        console.warn('[attention-toast]', lastError, stderrTail.slice(-400))
      }
    })
    alive = true
    write(JSON.stringify({ cmd: 'config', config }) + '\n')
    // The native host raises this process's main window on click, so it needs to
    // know which pid owns it (issue #1: "raise, not just focus").
    write(JSON.stringify({ cmd: 'owner', pid: process.pid, exe: process.execPath }) + '\n')
    console.log('[attention-toast] toast host spawned (' + command + ' ' + args.join(' ') + ')')
    return true
  }

  function ensureHost() {
    if (child !== null && alive) return true
    return spawnHost()
  }

  function show(payload) {
    if (!ensureHost()) return { ok: false }
    const id = String(payload?.id ?? ('anonymous:' + String(++anonymousToastSeq)))
    const target = toastRegistry.remember(payload, id)
    const command = {
      cmd: 'show',
      id,
      kind: target.kind,
      title: String(payload?.title ?? ''),
      text: String(payload?.text ?? ''),
      durationMs: Number(payload?.durationMs ?? config.durationMs),
    }
    return { ok: write(JSON.stringify(command) + '\n') }
  }

  const service = {
    getState() {
      return { config: clone(config), hostAlive: alive, desktop: true, lastError }
    },
    updateConfig(patch) {
      config = mergeConfig(config, patch ?? {})
      saveConfig(config)
      if (alive) write(JSON.stringify({ cmd: 'config', config }) + '\n')
      return clone(config)
    },
    show(payload) {
      return show(payload)
    },
    /** Internal lookup used by the click bridge (issue #1) and tests. */
    resolveToast(id) {
      return toastRegistry.resolve(id)
    },
    getUiEvents(sinceSeq) {
      const from = Number.isFinite(sinceSeq) ? sinceSeq : 0
      return {
        seq: clickQueue.seq,
        events: clickQueue.list(from).map((item) => toUiEvent(item)),
      }
    },
    ackUiEvents(seqs) {
      clickQueue.ack(seqs)
      // The browser half is frozen while the window is minimized or occluded, so
      // an ack line is the only proof that a click actually reached it.
      if (Array.isArray(seqs) && seqs.length > 0) hostLog('ui-ack seqs=' + seqs.join(','))
      return { ok: true }
    },
    preview() {
      ensureHost()
      return { ok: write('{"cmd":"preview"}\n') }
    },
    closeAll() {
      const ok = write('{"cmd":"close-all"}\n')
      toastRegistry.clear()
      clickQueue.clear()
      return { ok }
    },
    /**
     * Withdraw a queued pre-approval toast whose request was answered without
     * the user (session grant / allowlist), so the settings panel and the toast
     * never claim something is still waiting for a decision.
     */
    dropPending(callId) {
      if (typeof callId !== 'string' || callId === '') return false
      const item = pendingState.byCallId.get(callId)
      if (item === undefined) return false
      pendingState.byCallId.delete(callId)
      const index = pendingState.items.indexOf(item)
      if (index >= 0) pendingState.items.splice(index, 1)
      return true
    },
    getApprovals(sinceSeq, pendingSince) {
      // pending approvals are appended by the approval/request hook below
      refreshLedger()
      if (ledgerState.seq !== ledgerLogState.seq || ledgerState.exists !== ledgerLogState.exists) {
        ledgerLogState.seq = ledgerState.seq
        ledgerLogState.exists = ledgerState.exists
        hostLog('ledger seq=' + ledgerState.seq + ' exists=' + ledgerState.exists + ' total=' + ledgerState.items.length + ' path=' + LEDGER_PATH)
      }
      const from = Number.isFinite(sinceSeq) ? sinceSeq : 0
      return {
        seq: ledgerState.seq,
        exists: ledgerState.exists,
        file: LEDGER_PATH,
        items: ledgerState.items.filter((item) => item.seq > from).slice(-30),
        stats: summarizeItems(ledgerState.items),
        pendingSeq: pendingState.seq,
        pending: pendingState.items.filter((item) => item.seq > (Number.isFinite(pendingSince) ? pendingSince : 0)).slice(-20),
      }
    },
    /** Effective session-grant switches shown in Settings → Attention Toast. */
    getGrantsSettings() {
      const grants = effectiveGrants(grantsConfig, grantsDir)
      return {
        enabled: grants.enabled,
        dangerMaxUses: grants.dangerMaxUses,
      }
    },
    /** Flip one of them; the ledger half reads the same file on the next ask. */
    setGrantsSettings(patch) {
      const input = patch !== null && typeof patch === 'object' ? patch : {}
      writeSettings(grantsDir, {
        sessionGrants: typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {},
      })
      return service.getGrantsSettings()
    },
    restartHost() {
      stopHost()
      return { ok: spawnHost() }
    },
  }

  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'attentionToast', namespace: 'attentionToast' },
  })

  // Read-only pre-approval hook: classify and queue, never change the decision.
  try {
    ctx.on('approval/request', async (request, next) => {
      try {
        const tool = String(request?.toolName ?? request?.tool ?? 'approval')
        const reason = String(request?.reason ?? '')
        const sessionId = request?.agent?.session?.id ?? request?.agent?.sessionId ?? null
        pendingState.seq += 1
        const item = {
          seq: pendingState.seq,
          ts: new Date().toISOString(),
          tool,
          reason: reason.slice(0, 240),
          risk: riskLevelOf(riskOf, tool, reason),
          sessionId: typeof sessionId === 'string' ? sessionId : null,
        }
        pendingState.items.push(item)
        // Kept out of the wire payload: the client only needs seq/tool/reason/risk.
        if (typeof request?.callId === 'string' && request.callId !== '') {
          pendingState.byCallId.set(request.callId, item)
        }
        if (pendingState.items.length > 50) {
          pendingState.items = pendingState.items.slice(-50)
          for (const [callId, queued] of pendingState.byCallId) {
            if (!pendingState.items.includes(queued)) pendingState.byCallId.delete(callId)
          }
        }
        hostLog('approval request #' + pendingState.seq + ' tool=' + tool + ' risk=' + pendingState.items[pendingState.items.length - 1].risk)
      } catch { /* never break the waterfall */ }
      return next()
    })
  } catch (err) {
    hostLog('approval hook failed: ' + (err?.message ?? err))
  }

  ctx.provide('attentionToast', service)

  ctx.effect(() => {
    if (spawnEnabled) ensureHost()
    return () => {
      disposed = true
      stopHost()
    }
  }, 'approval-toast: toast host lifetime')

  console.log('[dsh-approval-toast] attention half loaded; toast host script = ' + SCRIPT)
  return service
}
