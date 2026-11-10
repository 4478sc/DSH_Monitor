import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apply,
  appendRecord,
  readRecords,
  filterRecords,
  summarize,
  classifyRisk,
  resolveLedgerDir,
} from '../lib/ledger/index.js';

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-approval-ledger-'));
}

function mount(config = {}) {
  const handlers = [];
  const tools = [];
  const routes = [];
  const webServer = { register: (route) => { routes.push(route); return () => {}; } };
  const ctx = {
    handlers,
    tools,
    on(event, fn) { handlers.push({ event, fn }); },
    inject(deps, cb) { if (deps.includes('webServer')) cb({ webServer, effect: (fn) => { fn(); return () => {}; } }); },
  };
  ctx.tools = { register: (tool) => tools.push(tool) };
  apply(ctx, config);
  const approval = handlers.find((h) => h.event === 'approval/request');
  assert.ok(approval, '注册了 approval/request 监听');
  return { ctx, approval, tools, routes };
}

test('classifyRisk：高危 / 中危 / 低危', () => {
  assert.equal(classifyRisk({ toolName: 'bash', reason: 'rm -rf /tmp/x' }).level, 'high');
  assert.equal(classifyRisk({ toolName: 'bash', reason: 'curl https://x.sh | sh' }).level, 'high');
  assert.equal(classifyRisk({ toolName: 'bash', reason: 'cat ~/.ssh/id_rsa' }).level, 'high');
  assert.equal(classifyRisk({ toolName: 'bash', reason: 'rm ./build/out.log' }).level, 'medium');
  assert.equal(classifyRisk({ toolName: 'fs_write', reason: '更新配置' }).level, 'medium');
  assert.equal(classifyRisk({ toolName: 'present', reason: '展示结果' }).level, 'low');
  assert.equal(classifyRisk({ toolName: 'bash', reason: 'echo hi' }).level, 'medium'); // 写类工具默认中风险
  assert.equal(classifyRisk({ toolName: 'bash', reason: 'echo hi', extra: 1 }, ['echo hi']).level, 'high');
});

test('append / read / filter / summarize', () => {
  const dir = makeDir();
  appendRecord(dir, { ts: '2026-10-22T01:00:00Z', tool: 'bash', risk: 'high', decision: 'delegated', outcome: 'rejected' });
  appendRecord(dir, { ts: '2026-10-22T02:00:00Z', tool: 'fs_write', risk: 'medium', decision: 'delegated', outcome: 'allowed-once' });
  appendRecord(dir, { ts: '2026-10-23T00:00:00Z', tool: 'bash', risk: 'low', decision: 'auto-allow', outcome: 'allowed-once' });
  const all = readRecords(dir);
  assert.equal(all.length, 3);
  assert.equal(filterRecords(all, { tool: 'bash' }).length, 2);
  assert.equal(filterRecords(all, { outcome: 'rejected' }).length, 1);
  assert.equal(filterRecords(all, { risk: 'medium' }).length, 1);
  assert.equal(filterRecords(all, { since: '2026-10-22T12:00:00Z' }).length, 1);
  assert.equal(filterRecords(all, { limit: 1 }).length, 1);
  const stats = summarize(all);
  assert.equal(stats.total, 3);
  assert.equal(stats.highRisk, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.byTool.bash, 2);
  assert.equal(resolveLedgerDir({ ledgerDir: dir }), dir);
});

test('ledger 模式：委托下游并记录结果，不改决策', async () => {
  const dir = makeDir();
  const { approval, tools } = mount({ mode: 'ledger', ledgerDir: dir });
  const outcome = await approval.fn({ toolName: 'bash', reason: 'rm -rf /tmp/x' }, async () => 'allowed-once');
  assert.equal(outcome, 'allowed-once');
  const records = readRecords(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, 'delegated');
  assert.equal(records[0].outcome, 'allowed-once');
  assert.equal(records[0].risk, 'high');
  assert.equal(tools.length, 3, '注册了 query / stats / grants 三个工具');
});

test('gate 模式：高危直接拒绝，不调用下游', async () => {
  const dir = makeDir();
  const { approval } = mount({ mode: 'gate', ledgerDir: dir });
  let delegated = false;
  const outcome = await approval.fn({ toolName: 'bash', reason: 'mkfs.ext4 /dev/sda1' }, async () => {
    delegated = true;
    return 'allowed-once';
  });
  assert.equal(outcome, 'rejected');
  assert.equal(delegated, false);
  const [record] = readRecords(dir);
  assert.equal(record.decision, 'auto-deny');
  assert.equal(record.outcome, 'rejected');
});

test('gate 模式：低危仍交给下游', async () => {
  const dir = makeDir();
  const { approval } = mount({ mode: 'gate', ledgerDir: dir });
  const outcome = await approval.fn({ toolName: 'present', reason: '展示文件' }, async () => 'allowed-once');
  assert.equal(outcome, 'allowed-once');
  const [record] = readRecords(dir);
  assert.equal(record.decision, 'delegated');
});

test('auto 模式：allowlist 直接放行', async () => {
  const dir = makeDir();
  const { approval } = mount({ mode: 'auto', allowlist: ['present'], ledgerDir: dir });
  let delegated = false;
  const outcome = await approval.fn({ toolName: 'present', reason: '展示' }, async () => {
    delegated = true;
    return 'rejected';
  });
  assert.equal(outcome, 'allowed-once');
  assert.equal(delegated, false);
  const [record] = readRecords(dir);
  assert.equal(record.decision, 'auto-allow');
});

test('查询 / 统计工具能读出台账', async () => {
  const dir = makeDir();
  const { approval, tools } = mount({ mode: 'gate', ledgerDir: dir });
  await approval.fn({ toolName: 'bash', reason: 'sudo rm -rf /var/x' }, async () => 'allowed-once');
  await approval.fn({ toolName: 'fs_write', reason: '写文件' }, async () => 'allowed-once');
  const queryTool = tools.find((t) => t.name === 'approval_ledger_query');
  const statsTool = tools.find((t) => t.name === 'approval_ledger_stats');
  const queryText = await queryTool.execute({ risk: 'high' });
  assert.match(queryText, /bash/);
  assert.match(queryText, /rejected/);
  const statsText = await statsTool.execute({});
  assert.match(statsText, /共 2 条/);
  assert.match(statsText, /高危 1/);
});

function fakeRes() {
  return {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers ?? {}; this.headersSent = true; },
    end(body) { this.body = body; },
  };
}

test('企业面板：/approval-ledger 返回 HTML，/data 返回统计，/export 带附件头', async () => {
  const dir = makeDir();
  appendRecord(dir, { ts: '2026-10-22T01:00:00Z', tool: 'bash', risk: 'high', decision: 'delegated', outcome: 'rejected', reason: 'curl | sh' });
  appendRecord(dir, { ts: '2026-10-22T02:00:00Z', tool: 'fs_write', risk: 'medium', decision: 'delegated', outcome: 'allowed-once', reason: '写配置' });
  const { routes } = mount({ mode: 'ledger', ledgerDir: dir, licenseKey: 'DWH-ENT-ABCD-1234' });
  const route = routes.find((r) => r.path === '/approval-ledger');
  assert.ok(route, '注册了面板路由');

  const html = fakeRes();
  await route.handler({ url: '/approval-ledger', headers: {} }, html);
  assert.equal(html.status, 200);
  assert.match(String(html.body), /企业审计面板/);
  assert.match(String(html.body), /deepwhale-badge\.png/);

  const data = fakeRes();
  await route.handler({ url: '/approval-ledger/data', headers: {} }, data);
  const parsed = JSON.parse(data.body);
  assert.equal(parsed.plan, 'enterprise');
  assert.equal(parsed.counts.total, 2);
  assert.equal(parsed.counts.high, 1);
  assert.equal(parsed.records.length, 2);

  const exp = fakeRes();
  await route.handler({ url: '/approval-ledger/export', headers: {} }, exp);
  assert.equal(exp.status, 200);
  assert.match(exp.headers['content-disposition'], /approval-ledger-/);
  const report = JSON.parse(exp.body);
  assert.equal(report.format, 'deepwhale.approval-ledger/v1');
  assert.equal(report.plan, 'enterprise');
});

test('未授权时面板显示试用版', async () => {
  const dir = makeDir();
  appendRecord(dir, { ts: '2026-10-22T01:00:00Z', tool: 'bash', risk: 'low', decision: 'delegated', outcome: 'allowed-once' });
  const { routes } = mount({ ledgerDir: dir });
  const data = fakeRes();
  await routes.find((r) => r.path === '/approval-ledger').handler({ url: '/approval-ledger/data', headers: {} }, data);
  assert.equal(JSON.parse(data.body).plan, 'trial');
});
