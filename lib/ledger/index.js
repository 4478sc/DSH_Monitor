/**
 * approval-toast — approval ledger host half (the merged plugin's ledger side).
 *
 * Upstream: `@deepwhale-cn/dsh-approval-ledger` by 温州深鲸智能科技有限公司.
 *
 * 审批台账：DSH 的审批（approval）由一个 waterfall 事件 `approval/request` 决定，
 * 答案只有 allowed-once / rejected / cancelled / unavailable 四种。本插件在这个
 * waterfall 上挂一个监听：
 *
 *   - `ledger`（默认）：不改变任何决策，只把每次审批请求 + 最终结果写进台账
 *   - `gate`：高危操作（rm -rf /、mkfs、dd、curl|sh、sudo、写 .ssh 等）直接 rejected，
 *             其余仍交给原有回答者
 *   - `auto`：allowlist 里的工具直接 allowed-once，其余照旧
 *
 * 台账写在 `$DSH_HOME/approval-ledger/ledger.jsonl`（没有 DSH_HOME 时用 `~/.dsh`），
 * 一行一条最终记录：时间 / 会话 / 工具 / 调用 id / 理由 / 风险等级 / 决策 / 结果。
 * 工具 `approval_ledger_query` 与 `approval_ledger_stats` 用来读它。
 *
 * 设计边界：默认 `ledger` 模式不改安全姿态；`gate` / `auto` 必须显式配置。
 *
 * @module @deepwhale-cn/dsh-approval-ledger
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { renderDashboardHtml, buildExport, licenseStatus } from './dashboard.js';

export const name = 'approval-ledger';
export const inject = ['tools'];

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
};

export const DEFAULT_CONFIG = {
  /** ledger = 只记录；gate = 拦高危；auto = 放行 allowlist。 */
  mode: 'ledger',
  /** auto 模式下直接放行的工具名。 */
  allowlist: [],
  /** gate 模式的额外高危正则（字符串，命中即拦）。 */
  denyPatterns: [],
  /** 台账目录；空则用 $DSH_HOME/approval-ledger 或 ~/.dsh/approval-ledger。 */
  ledgerDir: '',
  /** 企业授权 key（DWH-ENT-XXXX-XXXX）；空 = 试用。 */
  licenseKey: '',
};

/** 高危操作特征：命中任意一条 → risk=high。 */
const HIGH_RISK_PATTERNS = [
  /rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i,
  /\bmkfs(\.|\s|$)/i,
  /\bdd\s+if=/i,
  /curl[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  /wget[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  /\bsudo\b|\bdoas\b/,
  /chmod\s+777/,
  /\/etc\/(passwd|shadow|sudoers)/,
  /\.ssh\/(id_|authorized_keys|config)/,
  /(id_rsa|id_ed25519|\.pem|\.p12)\b/,
  /danger-full-access|dangerously-skip-permissions/i,
  />\s*\/dev\/(sd|disk)/,
  /\b(shutdown|reboot|halt)\b/,
];

/** 中风险特征：写操作 / 凭据 / 删除。 */
const MEDIUM_RISK_PATTERNS = [
  /\b(rm|rmdir|mv)\s/,
  /\b(chmod|chown)\s/,
  /\b(credential|secret|token|password|api[_-]?key)\b/i,
  /\b(delete|remove|overwrite|truncate)\b/i,
  /(删除|覆盖|清空|凭据|密钥|令牌)/,
];

const WRITE_TOOL_HINTS = /(bash|shell|exec|write|edit|fs|file|patch|delete|remove)/i;

/**
 * 给一次审批请求打风险标签。
 * @param {{toolName?: string, reason?: string}} request
 * @param {string[]} extraDenyPatterns
 * @returns {{level: 'high'|'medium'|'low', signals: string[]}}
 */
export function classifyRisk(request, extraDenyPatterns = []) {
  const tool = String(request?.toolName ?? '');
  const reason = String(request?.reason ?? '');
  const haystack = `${tool} ${reason}`;
  const signals = [];

  const extra = extraDenyPatterns
    .map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        return null;
      }
    })
    .filter((re) => re !== null);

  for (const pattern of [...HIGH_RISK_PATTERNS, ...extra]) {
    if (pattern.test(haystack)) signals.push(pattern.source.slice(0, 60));
  }
  if (signals.length > 0) return { level: 'high', signals };

  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(haystack)) signals.push(pattern.source.slice(0, 60));
  }
  if (signals.length > 0 || WRITE_TOOL_HINTS.test(tool)) return { level: 'medium', signals };
  return { level: 'low', signals };
}

/** 台账目录解析：config.ledgerDir > $DSH_HOME/approval-ledger > ~/.dsh/approval-ledger */
export function resolveLedgerDir(config = {}) {
  if (typeof config.ledgerDir === 'string' && config.ledgerDir.trim() !== '') return config.ledgerDir;
  const home = process.env.DSH_HOME;
  return home !== undefined && home !== ''
    ? path.join(home, 'approval-ledger')
    : path.join(os.homedir(), '.dsh', 'approval-ledger');
}

function ledgerPath(dir) {
  return path.join(dir, 'ledger.jsonl');
}

/** 追加一条最终记录（不抛错：台账失败不能影响审批本身） */
export function appendRecord(dir, record) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(ledgerPath(dir), `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读取全部记录（坏行跳过） */
export function readRecords(dir) {
  const file = ledgerPath(dir);
  if (!existsSync(file)) return [];
  const records = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // 坏行跳过：台账是日志，不因一行损坏整体不可读
    }
  }
  return records;
}

/**
 * 按条件筛选记录。
 * @param {object[]} records
 * @param {{tool?: string, decision?: string, outcome?: string, risk?: string, since?: string, limit?: number}} filter
 */
export function filterRecords(records, filter = {}) {
  const since = filter.since ? Date.parse(filter.since) : null;
  const matched = records.filter((r) => {
    if (filter.tool && !String(r.tool ?? '').includes(filter.tool)) return false;
    if (filter.decision && r.decision !== filter.decision) return false;
    if (filter.outcome && r.outcome !== filter.outcome) return false;
    if (filter.risk && r.risk !== filter.risk) return false;
    if (since !== null && !(Date.parse(r.ts) >= since)) return false;
    return true;
  });
  const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 20;
  return matched.slice(-limit);
}

/** 汇总统计（按风险 / 决策 / 结果 / 工具） */
export function summarize(records) {
  const by = (key) => {
    const map = {};
    for (const r of records) {
      const value = String(r[key] ?? 'unknown');
      map[value] = (map[value] ?? 0) + 1;
    }
    return map;
  };
  const risky = records.filter((r) => r.risk === 'high').length;
  const rejected = records.filter((r) => r.outcome === 'rejected').length;
  return {
    total: records.length,
    highRisk: risky,
    rejected,
    byRisk: by('risk'),
    byDecision: by('decision'),
    byOutcome: by('outcome'),
    byTool: by('tool'),
  };
}

function renderQuery(records) {
  if (records.length === 0) return '台账里没有匹配的记录（可能还没发生过审批，或筛选条件太严）。';
  const lines = ['审批台账（最近 ' + String(records.length) + ' 条）：', ''];
  for (const r of records) {
    const mark = r.outcome === 'rejected' ? '⛔' : r.outcome === 'allowed-once' ? '✅' : '·';
    lines.push(
      `${mark} ${String(r.ts ?? '').slice(0, 19).replace('T', ' ')}  ${String(r.tool ?? '?')}  ` +
        `风险 ${String(r.risk ?? '?')}  决策 ${String(r.decision ?? '?')}  结果 ${String(r.outcome ?? '?')}`,
    );
    if (r.reason) lines.push(`    理由：${String(r.reason).slice(0, 160)}`);
  }
  return lines.join('\n');
}

function renderStats(stats) {
  const fmt = (map) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' · ');
  return [
    `审批台账统计：共 ${String(stats.total)} 条`,
    `  高危 ${String(stats.highRisk)} 条 · 被拒 ${String(stats.rejected)} 条`,
    `  风险：${fmt(stats.byRisk)}`,
    `  决策：${fmt(stats.byDecision)}`,
    `  结果：${fmt(stats.byOutcome)}`,
    `  工具：${fmt(stats.byTool)}`,
  ].join('\n');
}

function resolveLicenseKey(cfg) {
  if (typeof cfg.licenseKey === 'string' && cfg.licenseKey.trim() !== '') return cfg.licenseKey.trim();
  const fromEnv = process.env.DSH_APPROVAL_LEDGER_LICENSE;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  try {
    const file = path.join(resolveLedgerDir(cfg), 'license.txt');
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  } catch {
    // 读不到就当未授权
  }
  return '';
}

function resolveConfig(config) {
  const cfg = config !== null && typeof config === 'object' ? config : {};
  const resolvedKey = resolveLicenseKey(cfg);
  return {
    mode: ['ledger', 'gate', 'auto'].includes(cfg.mode) ? cfg.mode : DEFAULT_CONFIG.mode,
    allowlist: Array.isArray(cfg.allowlist) ? cfg.allowlist.map(String) : [],
    denyPatterns: Array.isArray(cfg.denyPatterns) ? cfg.denyPatterns.map(String) : [],
    ledgerDir: resolveLedgerDir(cfg),
    // 授权来源优先级：配置 > 环境变量 > 台账目录里的 license.txt（企业离线部署）
    licenseKey: resolvedKey,
    license: licenseStatus(resolvedKey),
  };
}

/** 注册审批监听 + 两个查询工具 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config);

  // 加载时就把台账文件建出来：浮窗设置页靠"文件存在"判断连接状态，
  // 没有这次 touch 的话要等第一次审批才显示"已连接"。
  // 只读/权限不足时静默失败，首次审批时再尝试写入。
  const file = ledgerPath(cfg.ledgerDir);
  try {
    mkdirSync(cfg.ledgerDir, { recursive: true });
    if (!existsSync(file)) appendFileSync(file, '', 'utf8');
  } catch {
    /* 首次审批时再试 */
  }
  console.log('[approval-ledger] loaded mode=' + cfg.mode + ' ledger=' + file);

  // 审批 waterfall 监听：等下游给出最终结果后，把「请求 + 结果」写成一条记录。
  ctx.on('approval/request', async (request, next) => {
    const risk = classifyRisk(request, cfg.denyPatterns);
    const base = {
      ts: new Date().toISOString(),
      sessionId: request?.agent?.session?.id ?? request?.agent?.sessionId ?? null,
      tool: request?.toolName ?? null,
      callId: request?.callId ?? null,
      reason: request?.reason ?? null,
      risk: risk.level,
      signals: risk.signals,
      mode: cfg.mode,
    };

    if (cfg.mode === 'gate' && risk.level === 'high') {
      appendRecord(cfg.ledgerDir, { ...base, decision: 'auto-deny', outcome: 'rejected' });
      return 'rejected';
    }
    if (cfg.mode === 'auto' && cfg.allowlist.includes(String(request?.toolName ?? ''))) {
      appendRecord(cfg.ledgerDir, { ...base, decision: 'auto-allow', outcome: 'allowed-once' });
      return 'allowed-once';
    }

    const outcome = await next();
    appendRecord(cfg.ledgerDir, {
      ...base,
      decision: 'delegated',
      outcome: typeof outcome === 'string' ? outcome : 'unknown',
    });
    return outcome;
  });

  ctx.tools.register(defineTool({
    name: 'approval_ledger_query',
    description:
      '查询审批台账：agent 每次需要审批的工具调用（风险等级、决策、最终结果、理由）。可按工具/风险/决策/结果/时间筛选。',
    parameters: {
      tool: { type: 'string', description: '工具名包含匹配，例如 bash。' },
      risk: { type: 'string', description: '风险等级：high / medium / low。' },
      decision: { type: 'string', description: '决策：delegated / auto-deny / auto-allow。' },
      outcome: { type: 'string', description: '结果：allowed-once / rejected / cancelled / unavailable。' },
      since: { type: 'string', description: 'ISO 时间下界，例如 2026-10-22T00:00:00Z。' },
      limit: { type: 'number', description: '最多返回条数，默认 20。' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args) => renderQuery(filterRecords(readRecords(cfg.ledgerDir), args ?? {})),
    presentCall: () => ({ card: 'generic', kind: 'read', title: '查询审批台账' }),
  }));

  ctx.tools.register(defineTool({
    name: 'approval_ledger_stats',
    description: '审批台账汇总：总数、高危数、被拒数，以及按风险/决策/结果/工具的分布。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async () => renderStats(summarize(readRecords(cfg.ledgerDir))),
    presentCall: () => ({ card: 'generic', kind: 'read', title: '审批台账统计' }),
  }));

  // ── 企业审计面板（可选：宿主没有 webServer 时自动跳过）───────────────
  ctx.inject(['webServer'], (web) => {
    const sendJson = (res, status, value) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    web.effect(() => web.webServer.register({
      kind: 'prefix',
      path: '/approval-ledger',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/approval-ledger', 'http://x');
        const sub = url.pathname.replace(/^\/approval-ledger\/?/, '');
        const records = readRecords(cfg.ledgerDir);
        const report = buildExport(records, { plan: cfg.license.plan });

        if (sub === '' || sub === 'index.html') {
          const html = renderDashboardHtml();
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(html);
          return;
        }
        if (sub === 'data') {
          sendJson(res, 200, {
            plan: cfg.license.plan,
            counts: report.counts,
            records: [...records].sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? ''))).slice(0, 50),
          });
          return;
        }
        if (sub === 'export') {
          const stamp = new Date().toISOString().slice(0, 10);
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="approval-ledger-${stamp}.json"`,
            'cache-control': 'no-store',
          });
          res.end(JSON.stringify(report, null, 2));
          return;
        }
        sendJson(res, 404, { ok: false, error: 'not found' });
      },
    }));
  });
}
