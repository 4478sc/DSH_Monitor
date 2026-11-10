/**
 * 审批台账 · 企业审计面板（服务端渲染的 HTML + 同源 JSON 接口）
 *
 * 为什么做成 Web 面板而不是命令行：企业用户要"看得见、能导出、能审"，
 * 纯 CLI 输出对他们没有说服力。这个面板由宿主插件通过 webServer 挂在
 * `/approval-ledger/` 下，数据来自同一份 ledger.jsonl。
 *
 * 授权框架：`licenseKey` 形如 `DWH-ENT-XXXX-XXXX` 视为企业授权；
 * 未授权时面板可用（试用），导出带试用标记 —— 收费点放在"组织级能力"上，
 * 不把基础审批记录锁起来。
 */

const LICENSE_RE = /^DWH-ENT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** 授权状态：enterprise / trial */
export function licenseStatus(licenseKey) {
  const key = typeof licenseKey === 'string' ? licenseKey.trim() : '';
  return LICENSE_RE.test(key) ? { plan: 'enterprise', key: maskKey(key) } : { plan: 'trial', key: '' };
}

function maskKey(key) {
  return `${key.slice(0, 8)}****${key.slice(-4)}`;
}

/**
 * 生成导出用的结构化报告（企业版能力：可交付的审计报告）。
 * @param {object[]} records
 * @param {{plan?: string, generatedAt?: string}} meta
 */
export function buildExport(records, meta = {}) {
  const riskOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...records].sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
  const counts = { total: records.length, high: 0, rejected: 0, followUp: 0 };
  for (const r of records) {
    if (r.risk === 'high') counts.high += 1;
    if (r.outcome === 'rejected') counts.rejected += 1;
    if (r.risk === 'high' && r.outcome === 'allowed-once') counts.followUp += 1;
  }
  return {
    format: 'deepwhale.approval-ledger/v1',
    plan: meta.plan ?? 'trial',
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    counts,
    records: sorted.map((r) => ({
      ts: r.ts ?? null,
      tool: r.tool ?? null,
      risk: r.risk ?? null,
      decision: r.decision ?? null,
      outcome: r.outcome ?? null,
      reason: r.reason ?? null,
      signals: Array.isArray(r.signals) ? r.signals : [],
      sessionId: r.sessionId ?? null,
    })),
  };
}

export function renderDashboardHtml(branding = {}) {
  const badgeUrl = branding.badgeUrl ?? 'https://www.deepwhale.org.cn/images/badge/deepwhale-badge.png';
  const badgeHref = branding.badgeHref ?? 'https://deepwhale.org.cn';
  const badgeHtml = badgeUrl === '' ? '' : `<a class="dwh-brand" href="${badgeHref}" target="_blank" rel="noopener"><img src="${badgeUrl}" alt="powered by dwh" height="20"></a>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>审批台账 · 企业审计面板</title>
<style>
  :root{--bg:#f2f5fa;--card:#ffffff;--line:#dbe3ee;--fg:#111827;--fg2:#5b6b82;--teal:#0f9b8e;--amber:#b45309;--red:#d92d20;--blue:#1d4ed8}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);background:#ffffff}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--teal)}
  .plan{font-size:12.5px;padding:5px 12px;border-radius:999px;border:1px solid var(--line);color:var(--fg2);background:#f8fafc}
  .plan.ent{color:#ffffff;background:#0f9b8e;border-color:#0f9b8e;font-weight:700}
  main{max-width:1120px;margin:0 auto;padding:24px 28px 60px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .card .k{color:var(--fg2);font-size:12.5px}
  .card .v{font-size:34px;font-weight:800;margin-top:6px;letter-spacing:.5px}
  .card.high .v{color:var(--red)} .card.rej .v{color:var(--amber)} .card.fu .v{color:var(--blue)}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin-bottom:20px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .panel h2{margin:0 0 14px;font-size:16px;font-weight:700}
  .bar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:#e9eef5;border:1px solid var(--line)}
  .bar i{display:block;height:100%}
  .legend{display:flex;gap:18px;margin-top:10px;color:var(--fg2);font-size:12.5px;flex-wrap:wrap}
  .legend b{font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--fg2);font-weight:700;font-size:13px;white-space:nowrap;background:#f8fafc}
  td.reason{color:#374151;max-width:420px}
  .tag{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12.5px;border:1px solid var(--line);background:#f8fafc}
  .tag.high{color:var(--red);border-color:rgba(255,107,107,.45)}
  .tag.medium{color:var(--amber);border-color:rgba(240,180,90,.45)}
  .tag.low{color:var(--teal);border-color:rgba(45,212,191,.45)}
  .tag.rejected{color:var(--red)} .tag.allowed-once{color:var(--teal)}
  .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .btn{background:#ffffff;color:#1f2937;border:1px solid #cbd5e1;border-radius:9px;padding:8px 14px;font-size:13.5px;cursor:pointer}
  .btn.primary{background:#111827;color:#ffffff;font-weight:700;border-color:#111827}
  .btn:disabled{opacity:.5;cursor:default}
  .empty{color:var(--fg2);padding:26px 6px;text-align:center}
  .foot{color:var(--fg2);font-size:12px;margin-top:8px}
  .warn{color:var(--amber);font-size:12px;margin-top:8px;display:none}
 .dwh-brand{position:fixed;right:20px;bottom:16px;z-index:60;opacity:.85}
 .dwh-brand:hover{opacity:1}
 @media print{.dwh-brand{position:static;display:block;margin-top:14px}}
</style>
</head>
<body>
<div class="top">
  <div class="brand"><span class="dot"></span>审批台账 · 企业审计面板</div>
  <div class="toolbar">
    <span class="plan" id="plan">试用版</span>
    <button class="btn" id="refresh">刷新</button>
    <button class="btn primary" id="export">导出审计报告</button>
  </div>
</div>
<main>
  <div class="cards">
    <div class="card"><div class="k">审批总数</div><div class="v" id="c-total">—</div></div>
    <div class="card high"><div class="k">高危操作</div><div class="v" id="c-high">—</div></div>
    <div class="card rej"><div class="k">被拒绝</div><div class="v" id="c-rej">—</div></div>
    <div class="card fu"><div class="k">待复审（高危已放行）</div><div class="v" id="c-fu">—</div></div>
  </div>

  <div class="panel">
    <h2>风险分布</h2>
    <div class="bar" id="bar"></div>
    <div class="legend" id="legend"></div>
  </div>

  <div class="panel">
    <h2>审批记录（最近 50 条）</h2>
    <table>
      <thead><tr><th>时间</th><th>工具</th><th>风险</th><th>决策</th><th>结果</th><th>理由</th></tr></thead>
      <tbody id="rows"><tr><td colspan="6" class="empty">加载中…</td></tr></tbody>
    </table>
    <div class="warn" id="trial-warn">试用版导出会带「trial」标记；企业授权后导出为可交付审计报告。</div>
    <div class="foot" id="foot"></div>
  </div>
</main>
${badgeHtml}
<script>
(function(){
  var plan = 'trial';
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function tagClass(v){ return ['high','medium','low','rejected','allowed-once'].indexOf(v) >= 0 ? 'tag ' + v : 'tag'; }
  function render(data){
    var rows = data.records || [];
    var c = data.counts || {total:0,high:0,rejected:0,followUp:0};
    $('c-total').textContent = c.total;
    $('c-high').textContent = c.high;
    $('c-rej').textContent = c.rejected;
    $('c-fu').textContent = c.followUp;
    plan = data.plan || 'trial';
    $('plan').textContent = plan === 'enterprise' ? '企业授权' : '试用版';
    if (plan === 'enterprise') $('plan').className = 'plan ent';
    $('trial-warn').style.display = plan === 'enterprise' ? 'none' : 'block';

    var counts = {high:0, medium:0, low:0};
    rows.forEach(function(r){ if (counts[r.risk] !== undefined) counts[r.risk] += 1; });
    var total = rows.length || 1;
    var bar = $('bar'); bar.innerHTML = '';
    [['high','var(--red)'],['medium','var(--amber)'],['low','var(--teal)']].forEach(function(pair){
      var i = document.createElement('i');
      i.style.width = (100 * counts[pair[0]] / total) + '%';
      i.style.background = pair[1];
      bar.appendChild(i);
    });
    $('legend').innerHTML = [['高',counts.high],['中',counts.medium],['低',counts.low]].map(function(p){ return '<span>风险 <b>' + p[0] + '</b>：' + p[1] + '</span>'; }).join('');

    var tbody = $('rows');
    tbody.innerHTML = '';
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">还没有审批记录。agent 触发需要审批的操作后，这里会实时出现。</td></tr>';
      return;
    }
    rows.slice(0, 50).forEach(function(r){
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(String(r.ts || '').slice(0, 19).replace('T',' ')) + '</td>'
        + '<td>' + esc(r.tool) + '</td>'
        + '<td><span class="' + tagClass(r.risk) + '">' + esc(r.risk) + '</span></td>'
        + '<td>' + esc(r.decision) + '</td>'
        + '<td><span class="' + tagClass(r.outcome) + '">' + esc(r.outcome) + '</span></td>'
        + '<td class="reason">' + esc(r.reason) + '</td>';
      tbody.appendChild(tr);
    });
    $('foot').textContent = '共 ' + rows.length + ' 条记录';
  }
  function load(){
    fetch('/approval-ledger/data').then(function(r){ return r.json(); }).then(render).catch(function(e){
      $('rows').innerHTML = '<tr><td colspan="6" class="empty">读取台账失败：' + esc(e && e.message) + '</td></tr>';
    });
  }
  $('refresh').addEventListener('click', load);
  $('export').addEventListener('click', function(){
    window.location.href = '/approval-ledger/export';
  });
  load();
})();
</script>
</body>
</html>`;
}
