/**
 * Typert host manifest for dsh-approval-toast.
 *
 * The loader discovers `exports["./typert"]`, validates this manifest and
 * registers the invocations; the browser half mounts the matching descriptors
 * with `ctx.remote.$mount(...)` and then calls `remote.attentionToast.*`.
 */
import { z } from 'zod'

const colorSchema = z.object({
  bg: z.string(),
  fg: z.string(),
  accent: z.string(),
})

const configSchema = z.object({
  locale: z.enum(['zh', 'en']),
  width: z.number(),
  durationMs: z.number(),
  maxVisible: z.number(),
  colors: z.object({
    completed: colorSchema,
    failed: colorSchema,
    question: colorSchema,
    permission: colorSchema,
    sidelinedone: colorSchema,
  }),
})

const stateSchema = z.object({
  config: configSchema,
  hostAlive: z.boolean(),
  desktop: z.boolean(),
  lastError: z.string().nullable(),
})

const patchSchema = z.record(z.string(), z.unknown())

const toastTargetSchema = z.enum(['session', 'approval', 'question', 'summary'])

const showSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(['completed', 'failed', 'question', 'permission', 'sidelinedone']),
  title: z.string(),
  text: z.string().optional(),
  durationMs: z.number().optional(),
  // Navigation metadata (issue #1): never parse title/text to find a session.
  sessionId: z.string().optional(),
  target: toastTargetSchema.optional(),
  sessionIds: z.array(z.string()).optional(),
  interactionKey: z.string().optional(),
})

const ackSchema = z.object({ ok: z.boolean() })

const approvalSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  tool: z.string(),
  risk: z.string(),
  decision: z.string(),
  kind: z.string(),
  reason: z.string(),
  sessionId: z.string().nullable(),
})

const pendingApprovalSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  tool: z.string(),
  reason: z.string(),
  risk: z.string(),
  sessionId: z.string().nullable(),
})

const approvalStatsSchema = z.object({
  total: z.number(),
  high: z.number(),
  rejected: z.number(),
})

const approvalsSchema = z.object({
  seq: z.number(),
  exists: z.boolean(),
  file: z.string(),
  items: z.array(approvalSchema),
  stats: approvalStatsSchema,
  pendingSeq: z.number(),
  pending: z.array(pendingApprovalSchema),
})

const uiClickSchema = z.object({
  seq: z.number(),
  id: z.string(),
  sessionId: z.string().nullable(),
  kind: z.string(),
  target: toastTargetSchema,
  sessionIds: z.array(z.string()),
  interactionKey: z.string().nullable(),
  at: z.number(),
})

const uiEventsSchema = z.object({
  seq: z.number(),
  events: z.array(uiClickSchema),
})

const strictCodec = (typeSymbol, schema) => ({
  mode: 'strict',
  typeSymbol,
  schema,
  create: () => schema,
})

const stateCodec = strictCodec('dsh-approval-toast#ToastState', stateSchema)
const configCodec = strictCodec('dsh-approval-toast#ToastConfig', configSchema)
const patchCodec = strictCodec('dsh-approval-toast#ToastConfigPatch', patchSchema)
const showCodec = strictCodec('dsh-approval-toast#ToastPayload', showSchema)
const ackCodec = strictCodec('dsh-approval-toast#ToastAck', ackSchema)
const approvalsCodec = strictCodec('dsh-approval-toast#ApprovalList', approvalsSchema)
const uiEventsCodec = strictCodec('dsh-approval-toast#UiEvents', uiEventsSchema)

const invocation = (method, parameters, result) => ({
  id: 'dsh-approval-toast#attentionToast/' + method,
  service: 'attentionToast',
  namespace: 'attentionToast',
  method,
  invocation: { kind: 'direct' },
  parameters,
  result,
})

export const TYPERT = {
  package: 'dsh-approval-toast',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('getState', [], stateCodec),
    invocation('updateConfig', [{ name: 'patch', wire: 'patch', source: 'json', codec: patchCodec }], configCodec),
    invocation('show', [{ name: 'payload', wire: 'payload', source: 'json', codec: showCodec }], ackCodec),
    invocation('preview', [], ackCodec),
    invocation('getApprovals', [{ name: 'sinceSeq', wire: 'sinceSeq', source: 'json', codec: strictCodec('dsh-approval-toast#Seq', z.number()) }, { name: 'pendingSince', wire: 'pendingSince', source: 'json', codec: strictCodec('dsh-approval-toast#PendingSeq', z.number()) }], approvalsCodec),
    invocation('getUiEvents', [{ name: 'sinceSeq', wire: 'sinceSeq', source: 'json', codec: strictCodec('dsh-approval-toast#UiSeq', z.number()) }], uiEventsCodec),
    invocation('ackUiEvents', [{ name: 'seqs', wire: 'seqs', source: 'json', codec: strictCodec('dsh-approval-toast#UiSeqs', z.array(z.number())) }], ackCodec),
    invocation('closeAll', [], ackCodec),
    invocation('restartHost', [], ackCodec),
  ],
  model: {
    services: [{
      description: 'dsh-approval-toast desktop toast service (config + show).',
      summary: 'dsh-approval-toast desktop toast service.',
      tags: [],
      jsDoc: '/** dsh-approval-toast desktop toast service. */',
      key: 'attentionToast',
      exportName: 'AttentionToastService',
      members: [
        { kind: 'method', name: 'getState', signature: 'getState(): ToastState', summary: 'Read toast config and host health.' },
        { kind: 'method', name: 'updateConfig', signature: 'updateConfig(patch: ToastConfigPatch): ToastConfig', summary: 'Deep-merge toast appearance settings.' },
        { kind: 'method', name: 'show', signature: 'show(payload: ToastPayload): ToastAck', summary: 'Show one desktop toast and remember its session/target metadata.' },
        { kind: 'method', name: 'preview', signature: 'preview(): ToastAck', summary: 'Show sample toasts.' },
        { kind: 'method', name: 'getApprovals', signature: 'getApprovals(sinceSeq: number, pendingSince: number): ApprovalList', summary: 'New decided approvals from the optional approval-ledger file.' },
        { kind: 'method', name: 'getUiEvents', signature: 'getUiEvents(sinceSeq: number): UiEvents', summary: 'Native toast clicks not yet acknowledged by the client.' },
        { kind: 'method', name: 'ackUiEvents', signature: 'ackUiEvents(seqs: number[]): ToastAck', summary: 'Acknowledge consumed toast click events.' },
        { kind: 'method', name: 'closeAll', signature: 'closeAll(): ToastAck', summary: 'Dismiss every toast.' },
        { kind: 'method', name: 'restartHost', signature: 'restartHost(): ToastAck', summary: 'Restart the toast host process.' },
      ],
      types: [],
    }],
    events: [],
    objects: [],
  },
}

export default TYPERT
