/**
 * dsh-approval-toast — browser half (desktop notifications, merged with the approval ledger).
 *
 * Task-priority notification logic ported from attention-plugins
 * (main-line / side-line / task modes / 4 event types), delivered as a
 * bottom-right desktop toast by the host half (GTK toast host).
 */
window.__ModuleLoader__.load({
  id: 'dsh-approval-toast',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    // Kept from the standalone attention plugin so user settings survive the merge.
    const STORAGE_KEY = 'dsh-attention-toast:config'
    const DEFAULT_TYPES = { completed: true, failed: true, question: true, permission: true }

    const MESSAGES = {
      zh: {
        title: 'Attention Toast',
        subtitle: '主线立即提醒，支线可攒批，提问与审批永远打断你 —— 以桌面右下角浮窗呈现。',
        master: '启用桌面浮窗',
        priority: '任务优先级',
        taskMode: '任务模式',
        modeMainline: '主线模式',
        modeBalanced: '均衡模式',
        modeMainlineHint: '只标记的会话算主线；没标记时全部按支线处理。',
        modeBalancedHint: '没标记任何会话时，所有会话都按主线逐个提醒。',
        sideline: '支线提醒',
        sideEach: '逐个提醒',
        sideBatch: '全部结束汇总',
        events: '事件类型',
        evCompleted: '任务完成',
        evFailed: '任务出错',
        evQuestion: '收到提问',
        evPermission: '等待审批',
        toastBlock: '浮窗外观',
        duration: '显示时长',
        maxVisible: '同屏数量',
        notifyCurrent: '当前会话也提醒',
        notifyCurrentHint: '默认正在看的会话不打扰。',
        test: '测试浮窗',
        restart: '重启宿主',
        hostOn: '浮窗宿主已连接',
        hostOff: '浮窗宿主未连接',
        saved: '已保存',
        mainlineSet: '设为主线任务',
        mainlineUnset: '取消主线标记',
        allDone: '支线任务全部结束',
        allDoneBody: '{n} 个后台会话已空闲',
        doneBody: '任务已完成',
        failedBody: '任务出错',
        questionBody: '等待你回答',
        permissionBody: '等待你审批',
        seconds: '秒',
        count: '个',
        modeSilent: '静默模式',
        modeSilentHint: '完成与出错不弹浮窗；提问与审批仍然提醒。',
        waitSub: '等待子智能体',
        waitSubHint: '父会话结束时子代理仍在跑，等整波空闲再提醒。',
        currentMode: '当前会话',
        curHidden: '仅后台提醒',
        curUnfocused: '失焦或后台',
        curAlways: '总是提醒',
        mute: '静音此会话',
        unmute: '取消静音',
        mutedBadge: '已静音',
        approvalBlock: '审批联动（只读）',
        approvalFound: '已连接审批台账',
        approvalMissing: '未发现审批台账：最近记录不可用（等待浮窗仍可本地预判）',
        approvalToast: '审批浮窗（仅等待）',
        approvalStats: '台账最近',
        approvalHigh: '高危',
        approvalRejected: '被拒',
        riskPredict: '本地预判',
        approvalPending: '等待审批',
        riskNote: '（仅供参考）',
        riskSource: '等待审批时用本地规则预判风险；批准/拒绝只写入 dsh-approval-ledger 台账，不再弹结果浮窗。预判仅供参考。',
        grantsBlock: '会话授权记忆',
        grantsHint: '同一会话里你批准过一次「工具 + 权限档」，之后同类请求自动放行。',
        grantsEnabled: '启用会话授权记忆',
        grantsEnabledHint: '一次开关同时覆盖 workspace-write 与 danger-full-access；关闭时每个审批都会问你（默认）。',
        grantsDangerNote: '全盘访问（danger-full-access）最多自动放行 {n} 次；删除文件、高危操作永远要问你。',
        grantsUnknown: '读取授权设置中…',
        approvalDisclaimer: '本插件只读台账，不拦截、不批准任何操作，也不会在决策后重复弹窗。风险等级仅供参考，不构成安全保证。',
        approvedTitle: '已批准',
        rejectedTitle: '已拒绝',
        cancelledTitle: '已取消',
        otherTitle: '审批结果',
        interactionGoneTitle: '提醒已过期',
        interactionGoneBody: '这条提醒对应的处理项已经不在等待中；会话已打开，可直接继续。',
        sessionMissingTitle: '无法打开会话',
        sessionMissingBody: '目标会话已删除或暂不可用',
        untitled: '未命名',
        summaryPickerTitle: '关联会话',
        summaryDeleted: '已删除',
        summaryClose: '关闭',
      },
      en: {
        title: 'Attention Toast',
        subtitle: 'Main-line tasks interrupt immediately; side-line tasks can batch; questions and approvals always interrupt — shown as a desktop toast.',
        master: 'Enable desktop toasts',
        priority: 'Task priority',
        taskMode: 'Task mode',
        modeMainline: 'Main-line',
        modeBalanced: 'Balanced',
        modeMainlineHint: 'Only marked sessions are main-line; with no marker every session is side-line.',
        modeBalancedHint: 'With no marker, every session alerts individually.',
        sideline: 'Side-line alerts',
        sideEach: 'Each task',
        sideBatch: 'When all finish',
        events: 'Event types',
        evCompleted: 'Completed',
        evFailed: 'Failed',
        evQuestion: 'Question',
        evPermission: 'Approval',
        toastBlock: 'Toast appearance',
        duration: 'Duration',
        maxVisible: 'Max visible',
        notifyCurrent: 'Also alert for the current session',
        notifyCurrentHint: 'The session you are viewing stays quiet by default.',
        test: 'Preview toast',
        restart: 'Restart host',
        hostOn: 'Toast host connected',
        hostOff: 'Toast host offline',
        saved: 'Saved',
        mainlineSet: 'Mark as main-line',
        mainlineUnset: 'Unmark main-line',
        allDone: 'All side-line tasks finished',
        allDoneBody: '{n} background sessions are idle',
        doneBody: 'Task completed',
        failedBody: 'Task failed',
        questionBody: 'Waiting for your answer',
        permissionBody: 'Waiting for your approval',
        seconds: 's',
        count: '',
        modeSilent: 'Silent',
        modeSilentHint: 'No toast on completion or failure; questions and approvals still alert.',
        waitSub: 'Wait for subagents',
        waitSubHint: 'If subagents are still running when the parent finishes, alert once the wave is idle.',
        currentMode: 'Current session',
        curHidden: 'Only when hidden',
        curUnfocused: 'When unfocused',
        curAlways: 'Always',
        mute: 'Mute this session',
        unmute: 'Unmute session',
        mutedBadge: 'muted',
        approvalBlock: 'Approval ledger (read-only)',
        approvalFound: 'Approval ledger connected',
        approvalMissing: 'No approval ledger: recent records unavailable (pre-approval prediction still works)',
        approvalToast: 'Approval toast (request only)',
        approvalStats: 'Recent ledger',
        approvalHigh: 'high risk',
        approvalRejected: 'rejected',
        riskPredict: 'local prediction',
        approvalPending: 'Approval requested',
        riskNote: ' (reference only)',
        riskSource: 'Pending approvals use a local heuristic; decisions are written to dsh-approval-ledger only and do not pop a second toast. Advisory only.',
        grantsBlock: 'Session grants',
        grantsHint: 'Once you approve one tool + permission tier in a session, the same kind of request is answered automatically.',
        grantsEnabled: 'Remember approvals within a session',
        grantsEnabledHint: 'One switch covers both workspace-write and danger-full-access; when off, every approval asks (default).',
        grantsDangerNote: 'Full-disk access is auto-answered at most {n} times; deleting files and high-risk operations always ask.',
        grantsUnknown: 'Reading grant settings…',
        approvalDisclaimer: 'This plugin only reads the ledger; it never blocks or approves anything and does not pop a result toast after the decision. Risk levels are advisory and not a security guarantee.',
        approvedTitle: 'Approved',
        rejectedTitle: 'Rejected',
        cancelledTitle: 'Cancelled',
        otherTitle: 'Approval decision',
        sessionMissingTitle: 'Cannot open session',
        sessionMissingBody: 'The target session was deleted or is unavailable',
        interactionGoneTitle: 'Reminder is stale',
        interactionGoneBody: 'That item is no longer waiting for you; the session is open.',
        untitled: 'Untitled',
        summaryPickerTitle: 'Linked sessions',
        summaryDeleted: 'Deleted',
        summaryClose: 'Close',
      },
    }

    const isZh = () => {
      try {
        return (navigator.language || 'zh').toLowerCase().startsWith('zh')
      } catch {
        return true
      }
    }
    const t = (key) => MESSAGES[isZh() ? 'zh' : 'en'][key] ?? key

    // ── settings ────────────────────────────────────────────────────────────
    const MAINLINE_MODES = ['mainline', 'balanced', 'silent']
    const CURRENT_MODES = ['hidden', 'unfocused', 'always']

    function normalizeSettings(raw) {
      const value = raw !== null && typeof raw === 'object' ? raw : {}
      const types = { ...DEFAULT_TYPES }
      if (value.types !== null && typeof value.types === 'object') {
        for (const key of Object.keys(types)) {
          if (typeof value.types[key] === 'boolean') types[key] = value.types[key]
        }
      }
      const toast = value.toast !== null && typeof value.toast === 'object' ? value.toast : {}

      // Three-way task mode (0.2.2). Migrate the old taskMode + sidelineMode pair:
      //   balanced            -> balanced
      //   mainline + per-session -> balanced (every session rings on its own)
      //   mainline + batch       -> mainline  (one "all tasks" pool)
      let mainlineMode = value.mainlineMode
      if (!MAINLINE_MODES.includes(mainlineMode)) {
        if (value.taskMode === 'balanced' || value.sidelineMode === 'per-session') mainlineMode = 'balanced'
        else mainlineMode = 'mainline'
      }

      // Current-session gate (0.2.2). Migrate the old notifyCurrent boolean.
      let currentSessionMode = value.currentSessionMode
      if (!CURRENT_MODES.includes(currentSessionMode)) {
        currentSessionMode = value.notifyCurrent === true ? 'always' : 'hidden'
      }

      return {
        enabled: value.enabled !== false,
        approvalToasts: value.approvalToasts !== false,
        mainlineMode,
        currentSessionMode,
        waitForSubagents: value.waitForSubagents !== false,
        types,
        toast: {
          durationMs: Math.min(60000, Math.max(2000, Number(toast.durationMs) || 8000)),
          maxVisible: Math.min(6, Math.max(1, Number(toast.maxVisible) || 3)),
        },
        mainlineSessionIds: Array.isArray(value.mainlineSessionIds)
          ? value.mainlineSessionIds.filter((id) => typeof id === 'string' && id.length > 0)
          : [],
        mutedSessionIds: Array.isArray(value.mutedSessionIds)
          ? value.mutedSessionIds.filter((id) => typeof id === 'string' && id.length > 0)
          : [],
      }
    }

    /** Keep the old name so the settings store and tests read naturally. */
    const normalize = normalizeSettings

    function isMutedSession(sessionId, muted) {
      return Array.isArray(muted) && muted.includes(sessionId)
    }

    /**
     * Decide how one event should be delivered.
     * 'alert' = show now, 'aggregate' = pool into the "all tasks" toast,
     * 'never' = muted session or silent mode.
     */
    function decideAlert(kind, mainlineMode, markedMainline, muted) {
      if (muted) return 'never'
      if (kind === 'question' || kind === 'permission') return 'alert'
      if (mainlineMode === 'silent') return 'never'
      if (mainlineMode === 'balanced') return 'alert'
      return markedMainline ? 'alert' : 'aggregate'
    }

    /** Current-session gate: hidden / unfocused / always. */
    function shouldAlertCurrentSession(mode, state) {
      if (mode === 'always') return true
      if (mode === 'unfocused') return state.hidden === true || state.focused !== true
      return state.hidden === true
    }

    // Heuristic risk prediction for a pending approval (advisory only).
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
      /(删除|覆盖|清空|凭据|密钥|写入)/,
    ]

    /** Predict a risk level from tool + reason text. Advisory only. */
    function predictRisk(text) {
      const value = String(text ?? '')
      for (const re of RISK_HIGH) if (re.test(value)) return 'high'
      for (const re of RISK_MEDIUM) if (re.test(value)) return 'medium'
      return value.trim() === '' ? 'unknown' : 'low'
    }

    /** Running sessions whose direct parent is sessionId. */
    function countRunningChildren(sessionId, rows) {
      let count = 0
      for (const row of rows) {
        if (row && row.parentSessionId === sessionId && row.running === true) count += 1
      }
      return count
    }

    let settings = (() => {
      try {
        return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'))
      } catch {
        return normalize({})
      }
    })()

    const settingsListeners = new Set()
    const subscribeSettings = (fn) => {
      settingsListeners.add(fn)
      return () => { settingsListeners.delete(fn) }
    }
    const getSettings = () => settings

    function commitSettings(next) {
      settings = normalize(next)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      } catch (err) {
        console.warn('[attention-toast] cannot persist settings:', err)
      }
      for (const fn of [...settingsListeners]) {
        try { fn() } catch (err) { console.warn(err) }
      }
      queueHostSync()
    }

    function patchSettings(patch) {
      commitSettings({ ...settings, ...patch })
    }

    // ── main-line marker store ──────────────────────────────────────────────
    function isMainlineSession(sessionId, marked, mode) {
      if (marked.length > 0) return marked.includes(sessionId)
      return mode === 'balanced'
    }

    function toggleMainline(sessionId) {
      const ids = settings.mainlineSessionIds
      const next = ids.includes(sessionId) ? ids.filter((id) => id !== sessionId) : [...ids, sessionId]
      patchSettings({ mainlineSessionIds: next })
    }

    function toggleMute(sessionId) {
      const ids = settings.mutedSessionIds
      const next = ids.includes(sessionId) ? ids.filter((id) => id !== sessionId) : [...ids, sessionId]
      patchSettings({ mutedSessionIds: next })
    }

    const mainlineStore = {
      subscribe: subscribeSettings,
      getSnapshot: () => settings.mainlineSessionIds,
    }

    // ── host bridge ─────────────────────────────────────────────────────────
    let remoteApi = null
    let hostAlive = false
    let syncTimer = null

    function pushHostConfig() {
      if (remoteApi === null) return
      try {
        Promise.resolve(remoteApi.updateConfig({
          locale: isZh() ? 'zh' : 'en',
          durationMs: settings.toast.durationMs,
          maxVisible: settings.toast.maxVisible,
        })).catch(() => {})
      } catch { /* ignore */ }
    }

    function queueHostSync() {
      if (syncTimer !== null) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => { syncTimer = null; pushHostConfig() }, 300)
    }

    let toastSerial = 0

    /** Default navigation target for a toast kind. */
    function targetForKind(kind) {
      if (kind === 'permission') return 'approval'
      if (kind === 'question') return 'question'
      if (kind === 'sidelinedone') return 'summary'
      return 'session'
    }

    /** Stable, collision-free id for the lifetime of this client page. */
    function nextToastId(kind, sessionId) {
      toastSerial += 1
      return (sessionId ? sessionId + ':' : '') + kind + ':' + toastSerial
    }

    /** Add the issue #1 identity/target contract to a payload. */
    function normalizeToastPayload(payload) {
      const value = payload !== null && typeof payload === 'object' ? payload : {}
      const kind = typeof value.kind === 'string' && value.kind.length > 0 ? value.kind : 'completed'
      const sessionIds = Array.isArray(value.sessionIds)
        ? value.sessionIds.filter((id) => typeof id === 'string' && id.length > 0)
        : []
      const sessionId = typeof value.sessionId === 'string' && value.sessionId.length > 0
        ? value.sessionId
        : (sessionIds[0] ?? null)
      const target = ['session', 'approval', 'question', 'summary'].includes(value.target)
        ? value.target
        : targetForKind(kind)
      const id = typeof value.id === 'string' && value.id.length > 0
        ? value.id
        : nextToastId(kind, sessionId)
      const next = { ...value, id, kind, target }
      if (sessionId !== null) next.sessionId = sessionId
      if (sessionIds.length > 0) next.sessionIds = sessionIds
      else if (sessionId !== null && target === 'summary') next.sessionIds = [sessionId]
      if (typeof value.interactionKey !== 'string' || value.interactionKey.length === 0) delete next.interactionKey
      return next
    }

    function sendToast(payload) {
      if (remoteApi === null) return null
      const normalized = normalizeToastPayload(payload)
      try {
        Promise.resolve(remoteApi.show(normalized)).catch(() => {})
      } catch { /* ignore */ }
      return normalized.id
    }

    // ── approval ledger bridge (optional, read-only) ────────────────────────
    // dsh-approval-ledger is the writer; this half only reads its JSONL file
    // through the host service. Pending requests come from the host's
    // approval/request hook, decisions from the ledger.
    const ctxRef = { sessions: null, uiSession: null, uiWorkspace: null }
    const approvalStore = {
      items: [], pending: [], exists: false, file: '',
      stats: { total: 0, high: 0, rejected: 0 },
      listeners: new Set(),
    }
    const subscribeApprovals = (fn) => { approvalStore.listeners.add(fn); return () => { approvalStore.listeners.delete(fn) } }
    const getApprovals = () => approvalStore
    let approvalSeq = 0
    let pendingSeq = 0
    let pendingSeeded = false
    let approvalTimer = null

    function approvalTitle(kind) {
      if (kind === 'approved') return t('approvedTitle')
      if (kind === 'rejected') return t('rejectedTitle')
      if (kind === 'cancelled') return t('cancelledTitle')
      return t('otherTitle')
    }

    /** Resolve a session title for a toast; empty means "use the tool name". */
    function sessionTitle(sessionId) {
      try {
        const row = ctxRef.sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
        if (row && typeof row.title === 'string' && row.title.length > 0) return row.title
      } catch { /* fall back to the tool name */ }
      return ''
    }

    /** Shared "· <label> high (reference only)" suffix. */
    function riskSuffix(risk, labelKey) {
      if (typeof risk !== 'string' || risk === '' || risk === 'unknown') return ''
      return t(labelKey) + ' ' + risk + t('riskNote')
    }

    /** Pure payload for the pre-approval toast; null means suppress. */
    function buildPendingToast(item, title) {
      if (!settings.enabled || settings.approvalToasts === false) return null
      if (settings.types.permission === false) return null
      const parts = []
      if (item.tool) parts.push(String(item.tool))
      if (item.reason) parts.push(String(item.reason).slice(0, 140))
      const risk = riskSuffix(item.risk, 'riskPredict')
      if (risk !== '') parts.push(risk)
      return {
        id: 'pending:' + item.seq,
        kind: 'permission',
        kicker: t('approvalPending'),
        title: title || item.tool || 'approval',
        text: parts.join(' — '),
        durationMs: settings.toast.durationMs,
      }
    }

    /** Pre-approval toast: queued by the host's approval/request hook. */
    function toastPendingApproval(item) {
      const payload = buildPendingToast(item, sessionTitle(item.sessionId))
      if (payload === null) return
      // Prefer the real DSH interaction key so PR 4 can focus the exact card;
      // fall back to the host queue seq when the status store is not ready yet.
      const status = pendingStatusFor(item.sessionId)
      const pending = status?.pendingInteraction
      const interactionKey = pending !== null && pending !== undefined && typeof pending.key === 'string' && pending.key.length > 0
        ? pending.key
        : 'approval:' + String(item.seq)
      const extra = { target: 'approval', interactionKey }
      if (typeof item.sessionId === 'string' && item.sessionId.length > 0) extra.sessionId = item.sessionId
      sendToast({ ...payload, ...extra })
    }

    function pollApprovals() {
      if (remoteApi === null || typeof remoteApi.getApprovals !== 'function') return
      Promise.resolve(remoteApi.getApprovals(approvalSeq, pendingSeq)).then((result) => {
        if (!result || result.ok !== true || !result.value) return
        const value = result.value
        approvalSeq = typeof value.seq === 'number' ? value.seq : approvalSeq
        approvalStore.exists = value.exists === true
        approvalStore.file = typeof value.file === 'string' ? value.file : ''
        const stats = value.stats
        approvalStore.stats = stats !== null && typeof stats === 'object'
          ? { total: Number(stats.total) || 0, high: Number(stats.high) || 0, rejected: Number(stats.rejected) || 0 }
          : { total: 0, high: 0, rejected: 0 }
        const incoming = Array.isArray(value.items) ? value.items : []
        if (incoming.length > 0) {
          approvalStore.items = incoming.slice().reverse().concat(approvalStore.items).slice(0, 20)
        }
        const pending = Array.isArray(value.pending) ? value.pending : []
        if (typeof value.pendingSeq === 'number') pendingSeq = value.pendingSeq
        approvalStore.pending = pending.slice(-10)
        for (const fn of [...approvalStore.listeners]) { try { fn() } catch { /* ignore */ } }
        // The first poll adopts existing history instead of replaying it. Only
        // pending approvals toast; decided records feed the settings list and
        // never produce a second popup.
        if (!pendingSeeded) {
          pendingSeeded = true
        } else {
          for (const item of pending) toastPendingApproval(item)
        }
      }).catch(() => {})
    }

    function startApprovalPolling() {
      if (approvalTimer !== null) return
      pollApprovals()
      approvalTimer = setInterval(pollApprovals, 2500)
    }

    // ── native click → session navigation (issue #1) ───────────────────────
    let clickSeq = 0
    let clickTimer = null
    const handledClicks = new Set()

    /** Pure decision used by tests: open, missing, or summary picker. */
    function resolveUiClick(event, byId) {
      const target = event !== null && typeof event === 'object' ? event.target : undefined
      if (target === 'summary') return { action: 'summary', sessionId: null }
      const sessionId = typeof event?.sessionId === 'string' && event.sessionId.length > 0 ? event.sessionId : null
      if (sessionId === null) return { action: 'missing', sessionId: null }
      if (byId === null || typeof byId !== 'object' || byId[sessionId] === undefined || byId[sessionId] === null) {
        return { action: 'missing', sessionId }
      }
      return { action: 'open', sessionId }
    }

    function showSessionMissing() {
      sendToast({
        kind: 'failed',
        title: t('sessionMissingTitle'),
        text: t('sessionMissingBody'),
        durationMs: settings.toast.durationMs,
      })
    }

    /** The session opened, but the approval/question it pointed at is gone. */
    function showInteractionGone() {
      sendToast({
        kind: 'completed',
        title: t('interactionGoneTitle'),
        text: t('interactionGoneBody'),
        durationMs: settings.toast.durationMs,
      })
    }

    // ── summary session picker (issue #1 step 5) ───────────────────────────
    let summaryOverlay = null
    let summaryKeyHandler = null

    function closeSummaryPicker() {
      if (typeof document !== 'undefined' && summaryKeyHandler !== null) {
        document.removeEventListener('keydown', summaryKeyHandler)
      }
      summaryKeyHandler = null
      if (summaryOverlay !== null) {
        try { summaryOverlay.remove() } catch { /* ignore */ }
      }
      summaryOverlay = null
    }

    /** Pure list builder: keeps duplicates out and marks deleted sessions. */
    function buildSummaryItems(sessionIds, byId) {
      const list = Array.isArray(sessionIds) ? sessionIds : []
      const rows = byId !== null && typeof byId === 'object' ? byId : {}
      const seen = new Set()
      const items = []
      for (const value of list) {
        if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue
        seen.add(value)
        const session = rows[value]
        const exists = session !== null && session !== undefined
        const title = exists && typeof session.title === 'string' && session.title.length > 0
          ? session.title
          : t('untitled')
        items.push({ id: value, title, exists })
      }
      return items
    }

    let mainViewRef = null

    /** Acquire a main-view retention (fallback for DSH without uiWorkspace). */
    function retainSession(sessions, sessionId) {
      if (sessions === null || sessions === undefined || typeof sessions.retain !== 'function') {
        throw new Error('sessions.retain unavailable')
      }
      return sessions.retain(sessionId, { source: 'mainView' })
    }

    /** Pure uiWorkspace bridge used by tests. */
    function openSessionWith(uiWorkspace, sessionId) {
      if (uiWorkspace === null || uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') return false
      uiWorkspace.openSession(sessionId)
      return true
    }

    /** Navigate through the same service the sidebar uses. */
    function navigateToSession(sessionId) {
      if (openSessionWith(ctxRef.uiWorkspace, sessionId)) return
      const reference = retainSession(ctxRef.sessions, sessionId)
      const previous = mainViewRef
      mainViewRef = reference
      if (previous !== null && previous !== reference) {
        try { previous.release?.() } catch { /* ignore */ }
      }
      Promise.resolve(reference.ready).catch(() => {
        try { reference.release?.() } catch { /* ignore */ }
        if (mainViewRef === reference) mainViewRef = null
        showSessionMissing()
      })
    }

    function openSessionFromPicker(sessionId) {
      try {
        navigateToSession(sessionId)
      } catch {
        showSessionMissing()
      }
    }

    function openSummaryPicker(sessionIds) {
      closeSummaryPicker()
      const byId = ctxRef.sessions?.list?.getSnapshot?.()?.byId
      const items = buildSummaryItems(sessionIds, byId)
      if (items.length === 0 || !items.some((item) => item.exists)) {
        showSessionMissing()
        return
      }
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return

      const overlay = document.createElement('div')
      overlay.className = 'att-summary-overlay'
      overlay.setAttribute('role', 'dialog')
      overlay.setAttribute('aria-modal', 'true')
      overlay.setAttribute('aria-label', t('summaryPickerTitle'))
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;'

      const card = document.createElement('div')
      card.style.cssText = 'background:var(--dsw-alias-bg-elevated,#1f2329);color:var(--dsw-alias-label-primary,#e6edf3);border:1px solid var(--dsw-alias-border-secondary,#30363d);border-radius:10px;min-width:280px;max-width:440px;max-height:60vh;display:flex;flex-direction:column;box-shadow:0 12px 32px rgba(0,0,0,.45);overflow:hidden;'

      const head = document.createElement('div')
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-secondary,#30363d);font-size:13px;font-weight:600;'
      const label = document.createElement('span')
      label.textContent = t('summaryPickerTitle')
      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = '✕'
      close.title = t('summaryClose')
      close.setAttribute('aria-label', t('summaryClose'))
      close.style.cssText = 'border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:4px;'
      close.addEventListener('click', closeSummaryPicker)
      head.appendChild(label)
      head.appendChild(close)

      const list = document.createElement('div')
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px;overflow:auto;'
      let firstEnabled = null
      for (const item of items) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = item.exists ? item.title : item.title + ' · ' + t('summaryDeleted')
        button.disabled = !item.exists
        button.style.cssText = 'text-align:left;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;padding:8px 10px;font-size:12.5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (item.exists ? '' : 'opacity:.45;cursor:default;')
        if (item.exists) {
          button.addEventListener('click', () => {
            closeSummaryPicker()
            openSessionFromPicker(item.id)
          })
          if (firstEnabled === null) firstEnabled = button
        }
        list.appendChild(button)
      }
      card.appendChild(head)
      card.appendChild(list)
      overlay.appendChild(card)
      overlay.addEventListener('click', (event) => { if (event.target === overlay) closeSummaryPicker() })
      summaryKeyHandler = (event) => { if (event.key === 'Escape') closeSummaryPicker() }
      document.addEventListener('keydown', summaryKeyHandler)
      document.body.appendChild(overlay)
      summaryOverlay = overlay
      try { firstEnabled?.focus() } catch { /* ignore */ }
    }

    /** Read the pending interaction row for one session from uiSession. */
    function pendingStatusFor(sessionId) {
      const store = ctxRef.uiSession?.sessionStatus
      const snapshot = store?.getSnapshot?.()
      if (!snapshot) return null
      try {
        if (typeof snapshot.get === 'function') return snapshot.get(sessionId) ?? null
      } catch { /* fall through to forEach */ }
      let found = null
      try {
        snapshot.forEach?.((status, id) => { if (id === sessionId) found = status })
      } catch { /* ignore */ }
      return found
    }

    /** Pure pending matcher: mismatched keys mean the interaction was replaced. */
    function pendingInteractionFor(status, interactionKey) {
      const pending = status?.pendingInteraction
      if (pending === null || pending === undefined) return null
      if (typeof interactionKey === 'string' && interactionKey.length > 0 && pending.key !== interactionKey) return null
      return pending
    }

    function scrollTranscriptBottom() {
      try {
        const scroll = document.querySelector('[data-conversation-scroll]')
        if (scroll) {
          scroll.scrollTop = scroll.scrollHeight
          return true
        }
      } catch { /* ignore */ }
      return false
    }

    /** True when nothing is waiting in that session any more (nothing to focus). */
    function interactionIsGone(status, interactionKey) {
      if (pendingInteractionFor(status, interactionKey) !== null) return false
      const waiting = status?.pendingInteraction
      return waiting === null || waiting === undefined
    }

    /** Best-effort scroll/focus of the pending question/approval area. */
    function focusPendingArea(sessionId, interactionKey) {
      const status = pendingStatusFor(sessionId)
      const pending = pendingInteractionFor(status, interactionKey)
      if (pending === null) {
        // A different pending interaction is on screen: scroll near it, but do
        // not focus a stale card that belonged to the replaced notification.
        return status?.pendingInteraction !== null && status?.pendingInteraction !== undefined
          ? scrollTranscriptBottom()
          : false
      }
      const key = typeof pending.key === 'string' ? pending.key : ''
      // DSH's approval panel is the only card that exposes a stable hook
      // (data-approval-key = pending.key); there is no data-pending-* attribute
      // in the chat UI, so looking for one only wasted a querySelectorAll.
      let element = null
      if (key !== '') {
        try {
          for (const node of document.querySelectorAll('[data-approval-key]')) {
            if (node.getAttribute('data-approval-key') === key) { element = node; break }
          }
        } catch { /* ignore */ }
      }
      if (element !== null) {
        try { element.scrollIntoView?.({ block: 'center' }) } catch { /* ignore */ }
        try { element.focus?.() } catch { /* ignore */ }
        // The card scrolls internally; bring its body into view when it does.
        try {
          const body = element.querySelector('[data-approval-scroll]')
          body?.scrollIntoView?.({ block: 'nearest' })
        } catch { /* ignore */ }
        return true
      }
      // Fallback: the pending area lives at the bottom of the transcript.
      return scrollTranscriptBottom()
    }

    function handleUiClick(event) {
      const byId = ctxRef.sessions?.list?.getSnapshot?.()?.byId
      const result = resolveUiClick(event, byId)
      if (result.action === 'summary') {
        openSummaryPicker(event.sessionIds)
        return
      }
      if (result.action === 'missing') {
        showSessionMissing()
        return
      }
      try {
        if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus()
      } catch { /* ignore */ }
      try {
        navigateToSession(result.sessionId)
      } catch {
        showSessionMissing()
        return
      }
      if (event.target === 'approval' || event.target === 'question') {
        setTimeout(() => {
          try { focusPendingArea(result.sessionId, event.interactionKey) } catch { /* ignore */ }
          // Nothing is waiting there any more: say so instead of leaving the
          // user staring at a session that no longer needs them.
          try {
            if (interactionIsGone(pendingStatusFor(result.sessionId), event.interactionKey)) showInteractionGone()
          } catch { /* ignore */ }
        }, 150)
      }
    }

    function pollUiEvents() {
      if (remoteApi === null || typeof remoteApi.getUiEvents !== 'function') return
      Promise.resolve(remoteApi.getUiEvents(clickSeq)).then((result) => {
        if (!result || result.ok !== true || !result.value) return
        const value = result.value
        clickSeq = typeof value.seq === 'number' ? value.seq : clickSeq
        const events = Array.isArray(value.events) ? value.events : []
        const ack = []
        for (const event of events) {
          if (event === null || typeof event !== 'object' || typeof event.seq !== 'number') continue
          ack.push(event.seq)
          if (typeof event.at === 'number' && Date.now() - event.at > 60000) continue
          if (typeof event.id === 'string') {
            if (handledClicks.has(event.id)) continue
            handledClicks.add(event.id)
            if (handledClicks.size > 512) handledClicks.clear()
          }
          handleUiClick(event)
        }
        if (ack.length > 0) {
          Promise.resolve(remoteApi.ackUiEvents(ack)).catch(() => {})
        }
      }).catch(() => {})
    }

    function startClickPolling() {
      if (clickTimer !== null) return
      pollUiEvents()
      clickTimer = setInterval(pollUiEvents, 500)
    }

    // ── notification engine (ported from attention-plugins) ─────────────────
    class NotificationEngine {
      constructor(ports) {
        this.ports = ports
        this.prevRunning = new Map()
        this.runs = new Map()
        this.settling = new Set()
        this.pendingKeys = new Map()
        this.errors = new Map()
        this.errorCounts = new Map()
        this.deferred = new Map()
        this.aggregated = new Set()
        this.waveSeq = 0
        this.hadRunning = false
        this.poolPending = false
        this.aggregateSentThisWave = false
      }

      aggregates() {
        return this.ports.aggregateEnabled()
      }

      anyRunning() {
        for (const value of this.prevRunning.values()) {
          if (value) return true
        }
        return false
      }

      /** Emit the one-per-wave summary once nothing is running any more. */
      maybeEmitSummary() {
        if (!this.aggregates() || !this.poolPending || this.anyRunning() || this.aggregateSentThisWave) return
        this.emitSidelineComplete()
      }

      observe(sessions) {
        const seen = new Set()
        let hasRunning = false
        for (const summary of Object.values(sessions.byId || {})) {
          const id = summary.id
          seen.add(id)
          if (summary.running) hasRunning = true
          const prev = this.prevRunning.get(id) ?? false
          const now = summary.running
          if (prev && !now) void this.settleRun(id)
          else if (!prev && now) this.armRun(id)
          this.prevRunning.set(id, now)
        }
        this.hadRunning = hasRunning
        this.flushDeferred()
        for (const id of [...this.prevRunning.keys()]) {
          if (!seen.has(id)) this.forget(id)
        }
      }

      observeStatus(sessionId, running) {
        const prev = this.prevRunning.get(sessionId) ?? false
        if (prev && !running) void this.settleRun(sessionId)
        else if (!prev && running) this.armRun(sessionId)
        this.prevRunning.set(sessionId, running)
        const hasRunning = this.anyRunning()
        this.hadRunning = hasRunning
        this.flushDeferred()
      }

      observeAdded(summary) {
        if (summary === null || summary === undefined || summary.id === undefined) return
        if (this.prevRunning.has(summary.id)) return
        const running = summary.running === true
        this.prevRunning.set(summary.id, running)
        if (running) {
          this.armRun(summary.id)
          this.hadRunning = true
        }
      }

      observeRemoved(sessionId) {
        this.deferred.delete(sessionId)
        this.forget(sessionId)
      }

      forget(sessionId) {
        this.prevRunning.delete(sessionId)
        this.runs.delete(sessionId)
        this.pendingKeys.delete(sessionId)
        this.errors.delete(sessionId)
        this.errorCounts.delete(sessionId)
        this.aggregated.delete(sessionId)
      }

      observeError(sessionId, message) {
        if (typeof message === 'string' && message.length > 0) {
          this.errors.set(sessionId, message)
          this.errorCounts.set(sessionId, (this.errorCounts.get(sessionId) ?? 0) + 1)
        }
      }

      observePending(pending, options = {}) {
        for (const [id, facts] of pending) {
          const prevKey = this.pendingKeys.get(id)
          if (prevKey === undefined || prevKey !== facts.key) {
            const kind = facts.kind === 'approval' ? 'permission' : 'question'
            if (options.silent !== true && this.ports.alertAction(kind, id) !== 'never') {
              this.ports.emit({ kind, sessionId: id, title: this.ports.titleOf(id), detail: facts.detail })
            }
          }
          this.pendingKeys.set(id, facts.key)
        }
        for (const id of [...this.pendingKeys.keys()]) {
          if (!pending.has(id)) this.pendingKeys.delete(id)
        }
      }

      seed(sessions) {
        let hasRunning = false
        for (const summary of Object.values(sessions.byId || {})) {
          this.prevRunning.set(summary.id, summary.running)
          if (summary.running) {
            this.armRun(summary.id)
            hasRunning = true
          }
        }
        this.hadRunning = hasRunning
      }

      armRun(id) {
        // A wave starts when the first session begins after an idle period.
        // During seed(), hadRunning is still false for every session, so also
        // require an empty run set to avoid bumping the wave once per session.
        const startingWave = !this.hadRunning && this.runs.size === 0
        const detail = this.ports.detailOf(id)
        this.runs.set(id, {
          baselineTurnErrorSeq: detail?.maxTurnErrorSeq ?? 0,
          baselineAgentError: detail?.lastAgentError ?? null,
          baselineErrorCount: this.errorCounts.get(id) ?? 0,
        })
        if (startingWave) {
          this.waveSeq += 1
          this.aggregated.clear()
          this.aggregateSentThisWave = false
          this.poolPending = false
        }
      }

      async settleRun(id) {
        const run = this.runs.get(id)
        if (run === undefined || this.settling.has(id)) return
        this.runs.delete(id)
        this.settling.add(id)
        try {
          await this.ports.settle()
          if (this.runs.has(id)) return
          const detail = this.ports.detailOf(id)
          const errorCount = this.errorCounts.get(id) ?? 0
          const errorDuringRun = errorCount > run.baselineErrorCount ? (this.errors.get(id) ?? null) : null
          const failed = (detail !== undefined && (
            detail.maxTurnErrorSeq > run.baselineTurnErrorSeq ||
            (detail.lastAgentError !== null && detail.lastAgentError !== run.baselineAgentError)
          )) || errorDuringRun !== null
          const message = failed
            ? (detail?.failureMessage ?? errorDuringRun ?? detail?.lastAgentError ?? '')
            : (detail?.finalText ?? '')
          const kind = failed ? 'failed' : 'completed'
          const event = { kind, sessionId: id, title: this.ports.titleOf(id), detail: message }

          const action = this.ports.alertAction(kind, id)
          if (action === 'never') return
          if (action === 'aggregate') {
            this.aggregated.add(id)
            this.poolPending = true
            return
          }
          if (this.ports.waitForSubagents() && this.ports.runningChildren(id) > 0) {
            this.deferred.set(id, event)
            return
          }
          this.ports.emit(event)
        } finally {
          this.settling.delete(id)
          this.flushDeferred()
          this.maybeEmitSummary()
        }
      }

      flushDeferred() {
        if (this.deferred.size === 0) return
        for (const [id, event] of [...this.deferred]) {
          if (this.ports.runningChildren(id) > 0) continue
          this.deferred.delete(id)
          this.ports.emit(event)
        }
      }

      emitSidelineComplete() {
        if (this.prevRunning.size === 0) return
        // Only sessions that actually aggregated belong to this summary; the
        // main-line session is intentionally not in the list.
        const ids = this.aggregated.size > 0 ? [...this.aggregated] : [...this.prevRunning.keys()]
        if (ids.length === 0) return
        this.poolPending = false
        this.aggregateSentThisWave = true
        this.ports.emit({
          id: 'summary:' + String(this.waveSeq),
          kind: 'sidelinedone',
          sessionId: ids[0],
          sessionIds: ids,
          title: t('allDone'),
          detail: t('allDoneBody').replace('{n}', String(ids.length)),
        })
        this.aggregated.clear()
      }
    }

    // ── pending interactions (questions / approvals) ─────────────────────────
    function pendingDetail(interaction) {
      if (interaction.kind === 'approval') {
        const tool = typeof interaction.toolName === 'string' ? interaction.toolName : ''
        const reason = typeof interaction.reason === 'string' ? interaction.reason : ''
        if (tool !== '' && reason !== '') return tool + ' — ' + reason
        return reason !== '' ? reason : tool
      }
      const questions = interaction.questions
      if (Array.isArray(questions) && questions.length > 0) {
        const first = questions[0]
        if (first && typeof first.question === 'string') return first.question
      }
      return ''
    }

    function collectPending(snapshot) {
      const facts = new Map()
      if (!snapshot || typeof snapshot.forEach !== 'function') return facts
      snapshot.forEach((status, id) => {
        const interaction = status?.pendingInteraction
        if (!interaction) return
        const key = typeof interaction.key === 'string' ? interaction.key : ''
        if (key === '') return
        facts.set(id, {
          key,
          kind: interaction.kind === 'approval' ? 'approval' : 'question',
          detail: pendingDetail(interaction),
        })
      })
      return facts
    }

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS = [
      '.att-root{display:flex;flex-direction:column;gap:18px;padding:2px 2px 26px;font-size:13px;color:var(--dsw-alias-label-primary,inherit);max-width:560px}',
      '.att-hero{margin:0}',
      '.att-title{margin:0;font-size:19px;font-weight:650;letter-spacing:.01em}',
      '.att-sub{margin:6px 0 0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary,#8b949e)}',
      '.att-block{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.09));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.03))}',
      '.att-block-title{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8b949e)}',
      '.att-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px}',
      '.att-label{font-size:13px;color:var(--dsw-alias-label-secondary,#b9c0c8)}',
      '.att-hint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b949e)}',
      '.att-switch{position:relative;width:38px;height:22px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.06));cursor:pointer;padding:0;flex:none;transition:background .15s ease,border-color .15s ease}',
      '.att-switch[data-on="true"]{background:#2ea043;border-color:transparent}',
      '.att-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;opacity:.85;transition:transform .15s ease}',
      '.att-switch[data-on="true"]::after{transform:translateX(16px);opacity:1}',
      '.att-seg{display:flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}',
      '.att-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#b9c0c8);font-size:12px;padding:4px 10px;border-radius:7px;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.att-seg button[data-on="true"]{background:var(--dsw-alias-state-business-primary,#2f6feb);color:#fff}',
      '.att-btn{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary,inherit);font-size:12px;padding:5px 12px;border-radius:8px;cursor:pointer}',
      '.att-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.att-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.att-dot{width:8px;height:8px;border-radius:50%;display:inline-block}',
      '.att-star{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;font-size:15px;line-height:1;transition:background .15s ease}',
    ].join('')

    function useStyleOnce() {
      useEffect(() => {
        if (document.getElementById('att-style')) return
        const style = document.createElement('style')
        style.id = 'att-style'
        style.textContent = CSS
        document.head.appendChild(style)
      }, [])
    }

    // ── small primitives ────────────────────────────────────────────────────
    function Switch(props) {
      return h('button', {
        className: 'att-switch',
        type: 'button',
        'data-on': props.on ? 'true' : 'false',
        'aria-pressed': props.on ? 'true' : 'false',
        disabled: props.disabled,
        onClick: () => props.onChange(!props.on),
      })
    }

    function Segmented(props) {
      return h('div', { className: 'att-seg', role: 'tablist' },
        props.options.map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          role: 'tab',
          'data-on': props.value === value ? 'true' : 'false',
          'aria-selected': props.value === value ? 'true' : 'false',
          disabled: props.disabled,
          onClick: () => props.onChange(value),
        }, label)))
    }

    function Row(props) {
      return h('div', { className: 'att-row' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
          h('span', { className: 'att-label' }, props.label),
          props.hint ? h('span', { className: 'att-hint' }, props.hint) : null),
        props.children)
    }

    // ── settings section ────────────────────────────────────────────────────
    function SettingsSection() {
      useStyleOnce()
      const current = useSyncExternalStore(subscribeSettings, getSettings)
      const approval = useSyncExternalStore(subscribeApprovals, getApprovals)
      const stats = approval.stats || { total: 0, high: 0, rejected: 0 }
      const [host, setHost] = useState(null)
      const [grants, setGrants] = useState(null)
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let cancelled = false
        const refresh = () => {
          if (remoteApi === null) return
          Promise.resolve(remoteApi.getState()).then((result) => {
            if (cancelled) return
            if (result && result.ok && result.value) {
              hostAlive = result.value.hostAlive === true
              setHost(hostAlive)
            } else {
              setHost(false)
            }
          }).catch(() => { if (!cancelled) setHost(false) })
        }
        refresh()
        const timer = setInterval(refresh, 5000)
        return () => { cancelled = true; clearInterval(timer) }
      }, [])

      useEffect(() => {
        if (remoteApi === null) return
        let cancelled = false
        Promise.resolve(remoteApi.getGrantsSettings()).then((result) => {
          if (!cancelled && result && result.ok && result.value) setGrants(result.value)
        }).catch(() => {})
        return () => { cancelled = true }
      }, [])

      const patchGrants = (patch) => {
        if (remoteApi === null) return
        Promise.resolve(remoteApi.setGrantsSettings(patch)).then((result) => {
          if (result && result.ok && result.value) setGrants(result.value)
        }).catch(() => {})
      }

      const runPreview = () => {
        if (remoteApi === null) return
        setBusy(true)
        Promise.resolve(remoteApi.preview()).catch(() => {}).then(() => setTimeout(() => setBusy(false), 600))
      }
      const restart = () => {
        if (remoteApi === null) return
        Promise.resolve(remoteApi.restartHost()).catch(() => {})
      }

      const disabled = !current.enabled
      const modeHint = current.mainlineMode === 'silent'
        ? t('modeSilentHint')
        : current.mainlineMode === 'balanced' ? t('modeBalancedHint') : t('modeMainlineHint')

      return h('div', { className: 'att-root' },
        h('div', { className: 'att-hero' },
          h('h2', { className: 'att-title' }, t('title')),
          h('p', { className: 'att-sub' }, t('subtitle'))),

        h('div', { className: 'att-block' },
          h(Row, { label: t('master') },
            h(Switch, { on: current.enabled, onChange: (v) => patchSettings({ enabled: v }) }))),

        h('div', { className: 'att-block', style: disabled ? { opacity: 0.5 } : null },
          h('div', { className: 'att-block-title' }, t('priority')),
          h(Row, { label: t('taskMode'), hint: modeHint }, h(Segmented, {
            value: current.mainlineMode,
            disabled,
            options: [['mainline', t('modeMainline')], ['balanced', t('modeBalanced')], ['silent', t('modeSilent')]],
            onChange: (v) => patchSettings({ mainlineMode: v }),
          })),
          h(Row, { label: t('waitSub'), hint: t('waitSubHint') },
            h(Switch, {
              on: current.waitForSubagents !== false,
              disabled,
              onChange: (v) => patchSettings({ waitForSubagents: v }),
            }))),

        h('div', { className: 'att-block', style: disabled ? { opacity: 0.5 } : null },
          h('div', { className: 'att-block-title' }, t('events')),
          [['completed', t('evCompleted')], ['failed', t('evFailed')], ['question', t('evQuestion')], ['permission', t('evPermission')]]
            .map(([kind, label]) => h(Row, { key: kind, label },
              h(Switch, {
                on: current.types[kind] !== false,
                disabled,
                onChange: (v) => patchSettings({ types: { ...current.types, [kind]: v } }),
              })))),

        h('div', { className: 'att-block', style: disabled ? { opacity: 0.5 } : null },
          h('div', { className: 'att-block-title' }, t('toastBlock')),
          h(Row, { label: t('duration') }, h(Segmented, {
            value: String(current.toast.durationMs),
            disabled,
            options: [['4000', '4' + t('seconds')], ['6000', '6' + t('seconds')], ['8000', '8' + t('seconds')], ['12000', '12' + t('seconds')]],
            onChange: (v) => patchSettings({ toast: { ...current.toast, durationMs: Number(v) } }),
          })),
          h(Row, { label: t('maxVisible') }, h(Segmented, {
            value: String(current.toast.maxVisible),
            disabled,
            options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
            onChange: (v) => patchSettings({ toast: { ...current.toast, maxVisible: Number(v) } }),
          })),
          h(Row, { label: t('currentMode') }, h(Segmented, {
            value: current.currentSessionMode,
            disabled,
            options: [['hidden', t('curHidden')], ['unfocused', t('curUnfocused')], ['always', t('curAlways')]],
            onChange: (v) => patchSettings({ currentSessionMode: v }),
          }))),

        h('div', { className: 'att-block' },
          h('div', { className: 'att-block-title' }, t('approvalBlock')),
          h('div', { className: 'att-hint' }, t('approvalDisclaimer')),
          h('div', { className: 'att-hint' }, t('riskSource')),
          h(Row, { label: t('approvalToast'), hint: approval.exists ? t('approvalFound') : t('approvalMissing') },
            h(Switch, {
              on: current.approvalToasts !== false,
              disabled,
              onChange: (v) => patchSettings({ approvalToasts: v }),
            })),
          h('div', { className: 'att-hint', title: approval.file || '' },
            t('approvalStats') + ' · ' + String(stats.total) + ' · ' + t('approvalHigh') + ' ' + String(stats.high) + ' · ' + t('approvalRejected') + ' ' + String(stats.rejected)),
          approval.items.slice(0, 5).map((item) => h('div', { key: 'ap' + item.seq, style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary, #8b949e)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            approvalTitle(item.kind) + ' · ' + (item.tool || '—') + (item.risk ? ' · ' + item.risk : '')))),

        h('div', { className: 'att-block', style: disabled ? { opacity: 0.5 } : null },
          h('div', { className: 'att-block-title' }, t('grantsBlock')),
          h('div', { className: 'att-hint' }, t('grantsHint')),
          grants === null
            ? h('div', { className: 'att-hint' }, t('grantsUnknown'))
            : [
              h(Row, { key: 'grants-on', label: t('grantsEnabled'), hint: t('grantsEnabledHint') },
                h(Switch, {
                  on: grants.enabled === true,
                  disabled,
                  onChange: (v) => patchGrants({ enabled: v }),
                })),
              h('div', { key: 'grants-note', className: 'att-hint' },
                t('grantsDangerNote').split('{n}').join(String(grants.dangerMaxUses))),
            ]),

        h('div', { className: 'att-foot' },
          h('button', { className: 'att-btn', type: 'button', disabled: busy || disabled, onClick: runPreview }, busy ? '…' : t('test')),
          h('button', { className: 'att-btn', type: 'button', disabled, onClick: restart }, t('restart')),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #8b949e)' } },
            h('span', { className: 'att-dot', style: { background: host ? '#2ea043' : '#8b949e' } }),
            host ? t('hostOn') : t('hostOff'))))
    }

    // ── composer main-line star ─────────────────────────────────────────────
    function ComposerStar(props) {
      useStyleOnce()
      const ids = useSyncExternalStore(mainlineStore.subscribe, mainlineStore.getSnapshot)
      const sessionId = props.sessionId
      const active = sessionId !== null && sessionId !== undefined && ids.includes(sessionId)
      if (sessionId === null || sessionId === undefined) return null
      return h('button', {
        className: 'att-star',
        type: 'button',
        title: t(active ? 'mainlineUnset' : 'mainlineSet'),
        'aria-pressed': active ? 'true' : 'false',
        style: {
          background: active ? 'rgba(140,180,255,.16)' : 'transparent',
          color: active ? '#a8ccff' : 'var(--dsw-alias-label-tertiary, #8b949e)',
        },
        onClick: () => toggleMainline(sessionId),
      }, h('span', { style: { fontSize: '15px' } }, active ? '★' : '☆'))
    }

    // ── sidebar row menu item ───────────────────────────────────────────────
    function MenuItem(props) {
      const ids = useSyncExternalStore(mainlineStore.subscribe, mainlineStore.getSnapshot)
      const sessionId = props.sessionId
      if (sessionId === null || sessionId === undefined) return null
      let setMenuOpen
      if (typeof props.useMenuOpenState === 'function') {
        try { setMenuOpen = props.useMenuOpenState()?.[1] } catch { setMenuOpen = undefined }
      }
      const active = ids.includes(sessionId)
      const muted = isMutedSession(sessionId, settings.mutedSessionIds)
      const close = () => { try { setMenuOpen?.(false) } catch { /* ignore */ } }
      const styleFor = (highlight) => ({
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 10px',
        border: 'none', borderRadius: '6px', background: 'transparent',
        color: highlight ? '#a8ccff' : 'var(--dsw-alias-label-secondary, #a6a6a6)',
        fontSize: '12.5px', textAlign: 'left', cursor: 'pointer',
      })
      return h(React.Fragment, null,
        h('button', {
          type: 'button', role: 'menuitem', style: styleFor(active),
          onClick: (event) => { event.stopPropagation(); close(); toggleMainline(sessionId) },
        }, h('span', null, active ? '★' : '☆'), h('span', null, t(active ? 'mainlineUnset' : 'mainlineSet'))),
        h('button', {
          type: 'button', role: 'menuitem', style: styleFor(muted),
          onClick: (event) => { event.stopPropagation(); close(); toggleMute(sessionId) },
        }, h('span', null, muted ? '🔕' : '🔔'), h('span', null, t(muted ? 'unmute' : 'mute'))))
    }

    // ── toast dispatch ──────────────────────────────────────────────────────
    function deliver(event) {
      if (!settings.enabled) return
      // Approval requests are delivered by the host approval/request hook (it has
      // the tool, reason and prediction even when the pending state is brief).
      // Emitting here too produced two cards for one approval.
      if (event.kind === 'permission') return
      if (settings.types[event.kind] === false) return
      if (event.kind !== 'sidelinedone') {
        const isCurrent = viewTracker.current === event.sessionId
        const alert = shouldAlertCurrentSession(settings.currentSessionMode, {
          hidden: document.hidden,
          focused: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
        })
        if (isCurrent && !alert) return
      }
      let text = event.detail
      if (event.kind === 'permission' && text) {
        const predicted = predictRisk(text)
        if (predicted === 'high' || predicted === 'medium') {
          text = text + ' · ' + t('riskPredict') + ' ' + predicted + t('riskNote')
        }
      }
      if (event.kind === 'sidelinedone') text = event.detail
      else if (!text || text.length === 0) text = t(event.kind === 'failed' ? 'failedBody' : event.kind === 'completed' ? 'doneBody' : event.kind === 'question' ? 'questionBody' : 'permissionBody')
      const payload = {
        id: event.id,
        sessionId: event.sessionId,
        target: targetForKind(event.kind),
        kicker: event.kind === 'permission' ? t('approvalPending') : undefined,
        kind: event.kind,
        title: event.kind === 'sidelinedone' ? t('allDone') : (event.title || 'Untitled'),
        text: String(text).slice(0, 400),
        durationMs: settings.toast.durationMs,
      }
      if (event.kind === 'sidelinedone') {
        payload.sessionIds = Array.isArray(event.sessionIds) && event.sessionIds.length > 0
          ? event.sessionIds
          : (event.sessionId ? [event.sessionId] : [])
      }
      sendToast(payload)
    }

    const viewTracker = { current: null }

    // ── remote contribution ─────────────────────────────────────────────────
    const codec = (parse) => ({ parse })
    const stateCodec = codec((value) => ({
      config: value && value.config ? value.config : null,
      hostAlive: value?.hostAlive === true,
      desktop: value?.desktop === true,
      lastError: typeof value?.lastError === 'string' ? value.lastError : null,
    }))
    const configCodec = codec((value) => value)
    const ackCodec = codec((value) => ({ ok: value?.ok === true }))
    const patchCodec = codec((value) => value)
    const grantsCodec = codec((value) => ({
      enabled: value?.enabled === true,
      dangerMaxUses: Number.isFinite(value?.dangerMaxUses) ? value.dangerMaxUses : 5,
    }))
    const showCodec = codec((value) => value)

    const strict = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema, create: () => schema })

    const CONTRIBUTION = {
      package: 'dsh-approval-toast',
      descriptors: [
        { id: 'dsh-approval-toast#attentionToast/getState', service: 'attentionToast', namespace: 'attentionToast', method: 'getState', invocation: { kind: 'direct' }, parameters: [], result: strict('dsh-approval-toast#ToastState', stateCodec) },
        { id: 'dsh-approval-toast#attentionToast/updateConfig', service: 'attentionToast', namespace: 'attentionToast', method: 'updateConfig', invocation: { kind: 'direct' }, parameters: [{ name: 'patch', wire: 'patch', source: 'json', codec: strict('dsh-approval-toast#ToastConfigPatch', patchCodec) }], result: strict('dsh-approval-toast#ToastConfig', configCodec) },
        { id: 'dsh-approval-toast#attentionToast/show', service: 'attentionToast', namespace: 'attentionToast', method: 'show', invocation: { kind: 'direct' }, parameters: [{ name: 'payload', wire: 'payload', source: 'json', codec: strict('dsh-approval-toast#ToastPayload', showCodec) }], result: strict('dsh-approval-toast#ToastAck', ackCodec) },
        { id: 'dsh-approval-toast#attentionToast/getApprovals', service: 'attentionToast', namespace: 'attentionToast', method: 'getApprovals', invocation: { kind: 'direct' }, parameters: [{ name: 'sinceSeq', wire: 'sinceSeq', source: 'json', codec: strict('dsh-approval-toast#Seq', codec((v) => Number(v) || 0)) }, { name: 'pendingSince', wire: 'pendingSince', source: 'json', codec: strict('dsh-approval-toast#PendingSeq', codec((v) => Number(v) || 0)) }], result: strict('dsh-approval-toast#ApprovalList', codec((v) => v)) },
        { id: 'dsh-approval-toast#attentionToast/getUiEvents', service: 'attentionToast', namespace: 'attentionToast', method: 'getUiEvents', invocation: { kind: 'direct' }, parameters: [{ name: 'sinceSeq', wire: 'sinceSeq', source: 'json', codec: strict('dsh-approval-toast#UiSeq', codec((v) => Number(v) || 0)) }], result: strict('dsh-approval-toast#UiEvents', codec((v) => v)) },
        { id: 'dsh-approval-toast#attentionToast/ackUiEvents', service: 'attentionToast', namespace: 'attentionToast', method: 'ackUiEvents', invocation: { kind: 'direct' }, parameters: [{ name: 'seqs', wire: 'seqs', source: 'json', codec: strict('dsh-approval-toast#UiSeqs', codec((v) => Array.isArray(v) ? v : [])) }], result: strict('dsh-approval-toast#ToastAck', ackCodec) },
        { id: 'dsh-approval-toast#attentionToast/preview', service: 'attentionToast', namespace: 'attentionToast', method: 'preview', invocation: { kind: 'direct' }, parameters: [], result: strict('dsh-approval-toast#ToastAck', ackCodec) },
        { id: 'dsh-approval-toast#attentionToast/closeAll', service: 'attentionToast', namespace: 'attentionToast', method: 'closeAll', invocation: { kind: 'direct' }, parameters: [], result: strict('dsh-approval-toast#ToastAck', ackCodec) },
        { id: 'dsh-approval-toast#attentionToast/restartHost', service: 'attentionToast', namespace: 'attentionToast', method: 'restartHost', invocation: { kind: 'direct' }, parameters: [], result: strict('dsh-approval-toast#ToastAck', ackCodec) },
        { id: 'dsh-approval-toast#attentionToast/getGrantsSettings', service: 'attentionToast', namespace: 'attentionToast', method: 'getGrantsSettings', invocation: { kind: 'direct' }, parameters: [], result: strict('dsh-approval-toast#GrantsSettings', grantsCodec) },
        { id: 'dsh-approval-toast#attentionToast/setGrantsSettings', service: 'attentionToast', namespace: 'attentionToast', method: 'setGrantsSettings', invocation: { kind: 'direct' }, parameters: [{ name: 'patch', wire: 'patch', source: 'json', codec: strict('dsh-approval-toast#GrantsPatch', patchCodec) }], result: strict('dsh-approval-toast#GrantsSettings', grantsCodec) },
      ],
    }

    // ── plugin entry ────────────────────────────────────────────────────────
    const inject = ['slots', 'remote', 'sessions', 'uiSession', 'uiWorkspace']

    function apply(ctx) {
      ctxRef.sessions = ctx.sessions
      ctxRef.uiSession = ctx.uiSession
      ctxRef.uiWorkspace = ctx.uiWorkspace
      const slots = ctx.slots

      if (slots && typeof slots.inject === 'function') {
        ctx.effect(() => {
          const dispose = slots.inject('settings.section', () => slots.register({
            name: 'settings.section',
            id: 'dsh-approval-toast',
            order: 160,
            label: () => 'Attention Toast',
            inject: () => ({}),
          }, SettingsSection))
          return () => dispose?.()
        }, 'attention-toast: settings section')

        ctx.effect(() => {
          const dispose = slots.inject('conversation.input.left', () => slots.register({
            name: 'conversation.input.left',
            id: 'attention-toast-composer',
            order: 120,
            inject: () => ({}),
          }, ComposerStar))
          return () => dispose?.()
        }, 'attention-toast: composer star')

        ctx.effect(() => {
          const dispose = slots.inject('sidebar.workspaces.session.menu.item', () => slots.register({
            name: 'sidebar.workspaces.session.menu.item',
            id: 'attention-toast-menu',
            order: 150,
            label: () => 'Attention Toast',
            inject: () => ({}),
          }, MenuItem))
          return () => dispose?.()
        }, 'attention-toast: sidebar menu')
      }

      // Mount the Typert contribution so remote.attentionToast resolves.
      const remote = ctx.remote
      if (remote && typeof remote.$mount === 'function') {
        Promise.resolve(remote.$mount(CONTRIBUTION)).then((unmount) => {
          remoteApi = ctx.get('remote.attentionToast') ?? null
          ctx.effect(() => () => { try { unmount() } catch { /* ignore */ } }, 'attention-toast: remote contribution')
          if (remoteApi !== null) { pushHostConfig(); startApprovalPolling(); startClickPolling() }
        }).catch((err) => console.warn('[attention-toast] remote mount failed:', err))
      }

      // ── notification engine wiring ────────────────────────────────────────
      ctx.effect(() => {
        const sessionsSvc = ctx.sessions
        const listOf = () => sessionsSvc?.list?.getSnapshot?.()

        const engine = new NotificationEngine({
          titleOf: (sessionId) => {
            const row = listOf()?.byId?.[sessionId]
            return row?.title || 'Untitled'
          },
          detailOf: (sessionId) => {
            const row = listOf()?.byId?.[sessionId]
            if (row === undefined) return undefined
            return {
              maxTurnErrorSeq: 0,
              failureMessage: null,
              lastAgentError: row.lastAgentError ?? null,
              finalText: '',
            }
          },
          alertAction: (kind, sessionId) => {
            const marked = isMainlineSession(sessionId, settings.mainlineSessionIds, settings.mainlineMode)
            return decideAlert(kind, settings.mainlineMode, marked, isMutedSession(sessionId, settings.mutedSessionIds))
          },
          runningChildren: (sessionId) => {
            const snapshot = listOf()
            const rows = snapshot?.byId ? Object.values(snapshot.byId) : []
            return countRunningChildren(sessionId, rows)
          },
          waitForSubagents: () => settings.waitForSubagents,
          isMainline: (sessionId) => isMainlineSession(sessionId, settings.mainlineSessionIds, settings.mainlineMode),
          aggregateEnabled: () => settings.mainlineMode === 'mainline',
          emit: deliver,
          settle: () => new Promise((resolve) => setTimeout(resolve, 120)),
        })

        const snapshot = listOf()
        if (snapshot?.byId) engine.seed(snapshot)

        const offs = []
        const on = (event, handler) => {
          try {
            const off = remote.$on(event, handler)
            if (typeof off === 'function') offs.push(off)
          } catch (err) {
            console.warn('[attention-toast] subscribe failed', event, err)
          }
        }
        if (remote && typeof remote.$on === 'function') {
          on('api-session/added', (summary) => engine.observeAdded(summary))
          on('api-session/removed', (sessionId) => engine.observeRemoved(sessionId))
          on('api-session/status', (sessionId, running) => engine.observeStatus(sessionId, running))
          on('api-session/error', (sessionId, message) => engine.observeError(sessionId, message))
        }

        // Questions / approvals live on the UI status store, not on remote events.
        let pendingOff = () => {}
        const statusStore = ctx.uiSession?.sessionStatus
        if (statusStore && typeof statusStore.subscribe === 'function') {
          let first = true
          const sync = () => {
            try {
              engine.observePending(collectPending(statusStore.getSnapshot()), { silent: first })
              first = false
            } catch (err) {
              console.warn('[attention-toast] pending sync failed:', err)
            }
          }
          pendingOff = statusStore.subscribe(sync)
          sync()
        }

        return () => {
          for (const off of offs) { try { off() } catch { /* ignore */ } }
          try { pendingOff() } catch { /* ignore */ }
        }
      }, 'attention-toast: engine')
    }

    return {
      name: 'dsh-approval-toast',
      inject,
      apply,
      __test: { SettingsSection, predictRisk, normalizeSettings, patchSettings, decideAlert, shouldAlertCurrentSession, countRunningChildren, isMutedSession, approvalTitle, buildPendingToast, NotificationEngine, targetForKind, normalizeToastPayload, nextToastId, resolveUiClick, pendingInteractionFor, interactionIsGone, buildSummaryItems, retainSession, openSessionWith },
    }
  },
})
