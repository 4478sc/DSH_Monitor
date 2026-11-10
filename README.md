# dsh-approval-toast

**审批台账 + 桌面浮窗通知，一个 DSH 插件。**

[![test](https://github.com/4478sc/DSH_Monitor/actions/workflows/test.yml/badge.svg)](https://github.com/4478sc/DSH_Monitor/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-0f9b8e.svg)](LICENSE)

> Records every operation that needed approval (tool, reason, risk, decision, outcome), can reject high-risk ones, and — separately — pops bottom-right desktop toasts when a task finishes, fails, asks a question, or waits for approval. One install, one settings surface, one ledger.

![Windows toast](docs/images/toast-win.png)

这个仓库由两个独立插件合并而来，用于二次开发：

| 原插件 | 仓库 | 合并后去哪了 |
|---|---|---|
| 审批台账 @deepwhale-cn/dsh-approval-ledger | [feely0208/dsh-approval-ledger](https://github.com/feely0208/dsh-approval-ledger) | `lib/ledger/`（记录、风险分级、两个查询工具、审计面板） |
| 桌面浮窗 dsh-attention-toast | [4478sc/DSH_AttentionPlugins_Desktop](https://github.com/4478sc/DSH_AttentionPlugins_Desktop) | `lib/attention/` + `lib/client.js` + `lib/typert.host.js` |

合并前它们已经是**只读联动**关系（浮窗插件读台账插件写的 JSONL）；合并后这条通路变成进程内共享，不再需要装两个包。

## 为什么要合成一个

1. **一个审批事件只该被观察一次。** 两个插件都挂 `approval/request`，顺序不可控：如果台账先挂上并在 `gate` 模式直接 `rejected`，浮窗那一侧就永远看不到这次审批，"等待审批"卡片会丢。合并后由 `lib/index.js` 固定顺序：**先挂浮窗观察者，再挂台账决策者**。
2. **风险口径统一。** 浮窗卡上写的"预判风险 high（仅供参考）"和台账里存的 `risk` 现在是同一个分类器（`lib/ledger` 的 `classifyRisk`），不会再出现一边 high 一边 medium。`denyPatterns` 自定义规则同时作用于两者。
3. **少装一个包、少一份配置、少一处版本错位。**

## 功能

### 审批台账

DSH 的审批是一个 waterfall 事件（`approval/request`），台账半边挂一个监听器：

| 模式 | 行为 |
|---|---|
| `ledger`（默认） | **不改任何决策**，只记录：时间 / 会话 / 工具 / 调用 id / 理由 / 风险 / 决策 / 结果 |
| `gate` | 高危操作（`rm -rf`、`mkfs`、`dd`、`curl \| sh`、`sudo`、写 `.ssh`、`danger-full-access` 等）直接 `rejected`，其余交给原有回答者 |
| `auto` | `allowlist` 里的工具直接 `allowed-once`，其余照旧 |

审批结果只有四种：`allowed-once` / `rejected` / `cancelled` / `unavailable`。

台账写在 `$DSH_HOME/approval-ledger/ledger.jsonl`（没有 `DSH_HOME` 时用 `~/.dsh/approval-ledger/ledger.jsonl`），一行一条 JSON。写失败不影响审批本身；读的时候坏行跳过。

两个工具：

| 工具 | 作用 |
|---|---|
| `approval_ledger_query` | 按工具/风险/决策/结果/时间查询记录 |
| `approval_ledger_stats` | 总数、高危数、被拒数、会话授权自动放行数，以及按风险/决策/结果/工具/来源的分布 |
| `approval_ledger_grants` | 查看 / 撤销生效中的会话授权（`action: "revoke"`） |

审计面板（宿主有 `webServer` 时自动挂载，没有就跳过）：

| 路径 | 内容 |
|---|---|
| `/approval-ledger` | 服务端渲染的 HTML 面板（卡片 + 风险分布 + 最近 50 条 + 刷新/导出） |
| `/approval-ledger/data` | 同源 JSON：`{ plan, counts, records }` |
| `/approval-ledger/export` | 带 `content-disposition` 的审计报告（`deepwhale.approval-ledger/v1`） |

### 桌面浮窗

设置 → **Attention Toast** 里配置；行为细节见下表：

| 能力 | 行为 |
|---|---|
| 三档任务模式 | `mainline`：标记会话立即弹、其余汇总一次；`balanced`：逐个弹；`silent`：完成/失败不弹，提问与审批仍弹 |
| 当前会话三档 | `hidden` / `unfocused` / `always`（旧配置 `notifyCurrent=true` 自动迁移到 `always`） |
| 等待子智能体 | 父会话完成但仍有 running 子会话时挂起，整波空闲再弹 |
| 会话静音 | 会话行「…」菜单 🔕，该会话所有事件不弹 |
| 审批浮窗 | 请求时弹「等待审批 + 会话标题 + 工具 — 理由 — 预判风险」；批准/拒绝后不再弹结果卡 |
| 点击跳转 | 点浮窗切到对应会话；多会话汇总时弹会话选择器 |
| 台账联动 | 设置页显示"最近 5 条 + 连接状态"，台账缺失自动降级为"预判浮窗不受影响" |

浮窗宿主是常驻进程，走 JSON Lines：`show` / `close` / `close-all` / `config` / `preview` / `ping` / `shutdown` → `ready` / `shown` / `closed` / `clicked` / `error`。Windows 用 WPF（`lib/attention/toast_host.ps1`），Linux 用 GTK3（`lib/attention/toast_host.py`）。

## 安装

本仓库不发布到 npm，从源码装（**用 tarball，不要用 `link:`**——`link:` 会在 profile 里做目录联接，删 profile 前必须摘掉，否则跟着清空源目录）：

```powershell
npm install          # zod + 测试用的 dsh-tools
npm pack             # 产出 dsh-approval-toast-0.5.0.tgz

dsh plugin --profile desktop add .\dsh-approval-toast-0.5.0.tgz
```

装完**重启 DSH**：宿主半边（`lib/index.js`、`lib/attention/`）不会热重载，纯客户端（`lib/client.js`）改完 Ctrl+R 即可。

## 配置

台账半边读 DSH 插件配置（字段定义在 `lib/ledger/index.js` 的 `DEFAULT_CONFIG`）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mode` | `ledger` / `gate` / `auto` | `ledger` | 见上表 |
| `allowlist` | `string[]` | `[]` | `auto` 模式直接放行的工具名 |
| `denyPatterns` | `string[]` | `[]` | 追加高危正则；**同时**影响台账记录与浮窗预判 |
| `ledgerDir` | `string` | `''` | 台账目录；空则 `$DSH_HOME/approval-ledger` |
| `licenseKey` | `string` | `''` | 形如 `DWH-ENT-XXXX-XXXX` 视为企业授权，只影响面板导出标记 |
| `sessionGrants.enabled` | `boolean` | `false` | 打开"会话内授权记忆"，见下节（设置页也能开关，见下） |
| `sessionGrants.ttlMs` | `number` | `1800000` | 一次授权有效多久（1 分钟 ~ 24 小时） |
| `sessionGrants.maxUses` | `number` | `20` | 一次授权最多自动放行多少次 |
| `sessionGrants.allowDangerFullAccess` | `boolean` | `false` | 是否连 `danger-full-access` 也记忆（默认永不；设置页也能开关） |
| `sessionGrants.dangerMaxUses` | `number` | `5` | `danger-full-access` 授权最多自动放行几次（**上限 5**，不可调大） |
| `sessionGrants.alwaysAsk` | `string[]` | `[]` | 追加"永远要问我"的正则 |
| `toast.spawn` | `boolean` | `true` | `false` = 只跑台账、不起浮窗进程（无桌面/无头环境） |

浮窗外观（颜色、时长、同屏数量、语言）存在 `$DSH_HOME/storages/dsh-approval-toast/config.json`，由设置页写入；首次启动会从旧的 `storages/dsh-attention-toast/config.json` 复制一份，老用户设置不丢。

## 会话内授权记忆（Session grants）

默认关闭。打开后：**同一会话里你手动批准过一次 `(工具, sandbox 模式)`，之后同类请求直接放行**，不再弹审批。

```yaml
sessionGrants:
  enabled: true
  ttlMs: 1800000        # 30 分钟
  maxUses: 20
  allowDangerFullAccess: false
  alwaysAsk: ['kubectl delete', 'git push --force']
```

### 设置页开关

设置 → **Attention Toast** → **会话授权记忆** 里有这两个开关，改完立刻生效（不需要重启）：

| 开关 | 写入 | 效果 |
|---|---|---|
| 启用会话授权记忆 | `<ledgerDir>/settings.json` 的 `sessionGrants.enabled` | 关掉后每个审批都重新问你 |
| danger-full-access 也记住 | `sessionGrants.allowDangerFullAccess` | 打开后全盘访问也能被授权记忆，但**最多自动放行 5 次**（`dangerMaxUses`，硬上限 5，配置也调不大） |

设置页的两个值覆盖插件静态配置（`cordis` 里的 `sessionGrants`）；文件损坏或不存在时回退到静态配置，绝不会因为读不到文件而"意外打开"。写入是临时文件 + rename 原子替换。

**删除文件的操作永远要审批**：命中删除特征（`rm / rmdir / unlink / del / erase / remove / truncate / git clean`、中文"删除/清空/移除/抹掉/格式化"，或工具名本身是 `fs_delete` 这类）时，即使 `danger-full-access` 授权还在、次数还没用完，也一律退回问你。识别是关键字判断（审批请求不带工具参数），误判的代价只是多问一次。

粒度为什么是"工具 + 模式"而不是"这条命令"：DSH 的 `approval/request` 只带 `toolName / callId / reason / displayReason / signal`，**没有工具参数**，拿不到命令行和路径；能稳定解析的只有 `reason` 的固定前缀 `escalate sandbox to <mode>: <justification>`（来自 `@deepseek-ai/dsh-sandbox` 的 `approveEscalation`）。所以授权键是 `<sessionId>::<tool>::<mode>`，例如 `s-123::bash::workspace-write`。

判定顺序（在台账半边的 `approval/request` 钩子里）：

```
gate 命中 denyPatterns            → rejected（最高优先）
danger-full-access + 删除类操作    → 照旧问你（永不自动放行）
danger-full-access 且开关关闭      → 照旧问你
命中 alwaysAsk                     → 照旧问你
（justification 里）高危特征命中    → 照旧问你
有生效授权                         → allowed-once（台账记 source: session-grant）
其余                               → await next()
```

判定用的风险取自 justification（不含 `escalate sandbox to <mode>:` 前缀）：权限档本身由 `allowDangerFullAccess` + `dangerMaxUses` 管；如果把模式名算进风险，`danger-full-access` 会永远判 high，那两个开关就成了死代码。

授权存在台账本身：一行 `delegated + allowed-once` 就是"你批准过"，一行 `source: session-grant` 就是"用掉一次"。唯一额外状态是撤销，写在 `<ledgerDir>/grants.json`（台账 append-only，不能靠删行撤销）。失效条件：过期、次数用尽、会话结束、被撤销、或命中上面任一否决。撤销不是永久的：**同一个键再手动批准一次，撤销即被清除、授权重新生效**（比时间戳比较可靠——撤销和批准可能落在同一毫秒）。

自动放行**不会**弹"等待审批"卡片（浮窗那一侧的 pending 会被撤掉），但会：

- 在台账里留一行 `decision: auto-allow` / `source: session-grant`，审计面板"决策"列显示 `auto-allow · 授权`；
- 计入 `approval_ledger_stats` 的"会话授权自动放行"条数与 `bySource` 分布；
- 用工具 `approval_ledger_grants` 查看（`action: "list"`）或撤销（`action: "revoke", key: "…"`）；撤销后同类请求重新开始询问。

## 目录结构

```
lib/index.js                合成入口：先挂浮窗观察者，再挂台账决策者，注入统一风险分类器
lib/ledger/index.js         台账半边：approval hook、风险分级、JSONL 读写、两个工具、面板路由
lib/ledger/dashboard.js     HTML 面板、导出报告、授权状态
lib/ledger/grants.js        会话授权：解析 sandbox 模式、算授权键、判有效性、删除类识别、撤销文件
lib/ledger/settings.js      设置页开关的存储（<ledgerDir>/settings.json）与静态配置合并
lib/attention/index.js      浮窗宿主半边：Typert 服务 attentionToast、弹窗进程、点击队列
lib/attention/ledger-reader.js  台账 JSONL 的增量只读投影（坏行容错）
lib/attention/host-events.js    原生宿主事件解析 + 去重点击队列
lib/attention/toast-registry.js 浮窗 id → 会话/目标 的 TTL 注册表
lib/attention/toast_host.ps1    Windows WPF 宿主（UTF-8 **带 BOM**）
lib/attention/toast_host.py     Linux GTK3 宿主
lib/client.js               浏览器半边：设置页、通知引擎、审批/提问预判、点击跳转
lib/typert.host.js          Typert 清单（service: attentionToast）
tests/                      80 个用例，9 个文件
```

## 测试

```sh
npm test        # node --test
```

| 文件 | 覆盖 |
|---|---|
| `tests/ledger.test.mjs` | 风险分级、台账读写筛选、三种模式、查询统计工具、面板三个端点 |
| `tests/merge.test.mjs` | **合并契约**：一次 mount 两半都在；`gate` 拒绝时浮窗仍拿到 pending；三种模式与下游调用；自定义 `denyPatterns` 双向生效；风险口径一致 |
| `tests/manifest.test.mjs` | Typert 清单自洽（package 归属、id、strict codec） |
| `tests/grants.test.mjs` | **会话授权**：mode 解析、授权键、TTL/次数、撤销、删除类操作识别、danger-full-access 与 alwaysAsk 否决 |
| `tests/settings.test.mjs` | 设置页开关的存储：默认值、`dangerMaxUses` 上限 5、原子写、损坏文件回退、覆盖静态配置 |
| `tests/ledger-reader.test.mjs` | 记录归一化、delegated 按 outcome 分类、坏行跳过 |
| `tests/toast-registry.test.mjs` | 浮窗目标归一化、TTL 与上限淘汰 |
| `tests/host-events.test.mjs` | 宿主事件解析、点击去重与 ack |
| `tests/client-logic.test.mjs` | 设置迁移、三档决策、汇总、点击跳转、设置页结构回归 |

CI 在 **Ubuntu + Windows** 上跑同一套（Windows 额外校验 PowerShell 宿主能解析、且 BOM 还在）。

## 合并时改了什么

代码不是简单拼接，逐项说明（PR 里可复核）：

1. **新增 `lib/index.js` 合成入口。** 只导出 `name` / `inject` / `apply`；挂载顺序固定为"浮窗 → 台账"，解决 gate 模式吞掉 pending 的竞态。
2. **台账半边搬到 `lib/ledger/`**，逻辑未改：`classifyRisk` / `appendRecord` / `readRecords` / `filterRecords` / `summarize` / 两个工具 / 三个面板端点全部保留。
3. **浮窗半边搬到 `lib/attention/`**，只加三个接缝：`apply(ctx, options)` 接受注入的 `classify` 与 `spawn: false`（测试/无头）；存储目录迁到 `storages/dsh-approval-toast` 并自动继承旧配置；`predictRisk` 退化为无注入时的兜底。
4. **包身份统一**为 `dsh-approval-toast`：Typert 清单的 `package` 与 9 个 invocation id、客户端贡献 id 同步改名（loader 会校验 `manifest.package === package.json name`）。
5. **恢复被截断的 Windows 宿主**：上游仓库 `af69b6c` 里 `lib/toast_host.ps1` 只剩 3 字节 BOM（文件被清空但 BOM 保留），这里用实际发布过的 `.20` 构建内容补回（14456 字节），CI 增加 BOM 断言防止再犯。
6. **测试合并**：原有 9 + 38 个用例保留，新增 6 个合并契约用例，共 53 个，单条命令跑完。
7. **文档与法务**：README 双语合一；`LICENSE` 保留三方版权行；`THIRD-PARTY-NOTICES.md` 把台账从"可选、不打包"改成"已内置"。
8. **补上 0.2.9 的行为**：台账文件在插件加载时就创建（而不是等第一次审批），这样浮窗设置页一装好就显示"已连接"；`tests/merge.test.mjs` 增加了对应断言。

## 已知边界

- `gate` 只拦"高危特征"，不是完整安全策略；预判风险是本地正则，**仅供参考、不构成安全保证**。
- 浮窗宿主是独立进程；Windows 侧样式全靠 WPF，改 `toast_host.ps1` 后必须确认 BOM 还在（否则中文解析失败、无任何卡片）。
- 一个审批只该一张卡：`client.js` 的 `deliver()` 里 `if (event.kind === 'permission') return` 是去重关键，别删。
- 面板的"企业授权"是上游作者的商业点（`DWH-ENT-*`），二次开发可以直接移除，不影响记录与导出。
- 会话授权（`sessionGrants`）默认关闭；粒度是"工具 + sandbox 模式"，不是"这条命令"——DSH 的审批请求不带工具参数，想要命令级记忆需要在实现里用 `callId` 去会话日志回捞参数（未实现）。
- 删除类操作的识别是**关键字**判断（工具名 + 模型的理由），因为审批请求不带参数；误判的代价只是多问你一次。

---

## English

**One DSH plugin: an approval ledger plus desktop toasts.**

This repository merges two previously separate plugins:

- `@deepwhale-cn/dsh-approval-ledger` ([feely0208/dsh-approval-ledger](https://github.com/feely0208/dsh-approval-ledger)) — records every approval (tool, reason, risk, decision, outcome), adds the `approval_ledger_query` / `approval_ledger_stats` tools, an optional `gate` mode that rejects high-risk operations, and a `/approval-ledger` audit dashboard.
- `dsh-attention-toast` ([4478sc/DSH_AttentionPlugins_Desktop](https://github.com/4478sc/DSH_AttentionPlugins_Desktop)) — bottom-right desktop toasts (Windows WPF / Linux GTK3) for completed, failed, question and approval events, with task modes, per-session mute, wait-for-subagents and click-to-navigate.

They were already coupled through one file (`$DSH_HOME/approval-ledger/ledger.jsonl`); merging turns that into an in-process contract:

1. **Ordering.** `lib/index.js` mounts the toast observer before the ledger decider, so a `gate`-mode rejection can no longer swallow the "waiting for approval" toast.
2. **One risk scale.** The ledger's `classifyRisk` (including `denyPatterns`) feeds the toast hint, so the badge on the card and the `risk` field in the ledger always agree.
3. **One install, one settings page, one version.**

Install from source (tarball, never `link:`):

```powershell
npm install
npm pack
dsh plugin --profile desktop add .\dsh-approval-toast-0.5.0.tgz
```

### Do not ask twice (session grants)

`sessionGrants` is off by default. When enabled, approving one sandbox escalation (`bash` → `workspace-write`) answers later escalations of the **same tool and same sandbox mode in the same session** without a prompt, bounded by `ttlMs`, `maxUses`, an explicit revocation list (`<ledgerDir>/grants.json`) and hard vetoes:

- high-risk operations always ask, whatever the grant says;
- **anything that deletes files always asks**, even under a live `danger-full-access` grant;
- `danger-full-access` is never remembered unless `allowDangerFullAccess: true`, and then only for **five uses** (`dangerMaxUses`, hard cap 5);
- `alwaysAsk` regexes, rejections and gate mode are never overridden.

Both user-facing switches live in **Settings → Attention Toast → Session grants** and are stored in `<ledgerDir>/settings.json`, which overrides the static plugin config when present (a corrupt file falls back to the config, never to "on").

Grants live in the ledger itself (one `delegated + allowed-once` row is "the user said yes", one `source: session-grant` row is a use), so `approval_ledger_stats`, the dashboard and the audit export show exactly how often the plugin answered for you. `approval_ledger_grants` lists and revokes them; a revoke is not permanent — approving the same key again clears it and re-arms the grant (comparing timestamps would be ambiguous, since a revoke and an approval can share a millisecond). Granularity is per tool + mode because the approval waterfall carries no tool arguments — see the Chinese section above for why.

Tests: `npm test` (70 cases, 8 files, Ubuntu + Windows CI).

## License

MIT © 4478sc · 温州深鲸智能科技有限公司 (approval ledger) · zjbc2000 (attention-plugins) · YiMlT (dsh-notify-yimit).
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the full attribution chain.
