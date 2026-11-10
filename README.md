# 审批台账 · dsh-approval-ledger

[English](README.en.md) ・ **简体中文**

[![test](https://github.com/4478sc/DSH_Monitor/actions/workflows/test.yml/badge.svg)](https://github.com/4478sc/DSH_Monitor/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-0f9b8e.svg)](LICENSE)

> DSH 插件：记录 agent 每一次**需要审批**的操作——它想做什么、为什么、风险多高、最后批没批；可按规则拦住高危动作，并带一个能导出审计报告的 Web 面板。

记录的东西长这样：

```
✅ 2026-10-22 09:31:12  bash  风险 high  决策 delegated  结果 rejected
    理由：安装依赖需要执行 curl | sh
```

## 复刻声明

本仓库是 [feely0208/dsh-approval-ledger](https://github.com/feely0208/dsh-approval-ledger) 的**复刻副本**，用于个人二次开发：

| 项目 | 值 |
|---|---|
| 上游仓库 | `feely0208/dsh-approval-ledger` |
| 上游版本 | `0.2.8`（tag `v0.2.8`，commit `49beec0`） |
| 复刻范围 | `lib/`、`tests/`、`icon.svg`、`cordis.patch.yml` 与上游**逐字节一致**；文档、包元数据、仓库配套按本仓库调整 |
| 授权 | MIT，原版权归温州深鲸智能科技有限公司；见 [LICENSE](LICENSE) |

上游网络可达时，也可直接装上游包：

```sh
dsh plugin --profile web add @deepwhale-cn/dsh-approval-ledger
```

## 它是怎么工作的

DSH 的审批是一个 waterfall 事件（`approval/request`），本插件在这个 waterfall 上挂一个监听器，按 `mode` 决定要不要干预：

| 模式 | 行为 |
|---|---|
| `ledger`（默认） | **不改任何决策**，只记录：时间 / 会话 / 工具 / 调用 id / 理由 / 风险 / 决策 / 结果 |
| `gate` | 高危操作（`rm -rf`、`mkfs`、`dd`、`curl \| sh`、`sudo`、写 `.ssh`、`danger-full-access` 等）直接 `rejected`，其余交给原有回答者 |
| `auto` | `allowlist` 里的工具直接 `allowed-once`，其余照旧 |

审批结果只有四种：`allowed-once` / `rejected` / `cancelled` / `unavailable`。

## 安装（从本仓库）

本仓库**没有发布到 npm**（包名沿用了上游作用域，直接 `npm publish` 会被拒）。本地安装用 tarball，不要用 `link:`——`link:` 会在 profile 里做成目录联接，删 profile 时会把源码目录一起清空：

```powershell
npm install          # 只装 devDependency @deepseek-ai/dsh-tools，用于跑测试
npm pack             # 产出 deepwhale-cn-dsh-approval-ledger-0.2.8.tgz

dsh plugin --profile desktop add .\deepwhale-cn-dsh-approval-ledger-0.2.8.tgz
```

装完**重启 DSH**（host 半边 `lib/index.js` 不热加载）。默认 `ledger` 模式，装上就开始记录，**不改变任何审批行为**。

要启用拦截，在 profile 的插件配置里加 `mode: gate` 并重启。

## 配置

配置字段定义在 `lib/index.js` 的 `DEFAULT_CONFIG`：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mode` | `ledger` \| `gate` \| `auto` | `ledger` | 见上表 |
| `allowlist` | `string[]` | `[]` | `auto` 模式下直接放行的工具名 |
| `denyPatterns` | `string[]` | `[]` | 追加到高危清单的正则（字符串，命中即 `high`） |
| `ledgerDir` | `string` | `''` | 台账目录；空则用 `$DSH_HOME/approval-ledger` |
| `licenseKey` | `string` | `''` | 形如 `DWH-ENT-XXXX-XXXX` 视为企业授权，仅影响面板导出的标记 |

## 台账位置

`$DSH_HOME/approval-ledger/ledger.jsonl`（没有 `DSH_HOME` 时用 `~/.dsh/approval-ledger/ledger.jsonl`），一行一条 JSON。

写台账失败不影响审批本身（`appendRecord` 吞掉异常），读的时候坏行跳过——它是日志，不是状态机。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `approval_ledger_query` | 按工具/风险/决策/结果/时间查询记录 |
| `approval_ledger_stats` | 总数、高危数、被拒数，以及按风险/决策/结果/工具的分布 |

## 企业审计面板

宿主有 `webServer` 时（`ctx.inject(['webServer'], ...)`，没有就静默跳过），插件在 `/approval-ledger/` 下挂四类端点：

| 路径 | 内容 |
|---|---|
| `/approval-ledger` | 服务端渲染的 HTML 面板（卡片 + 风险分布条 + 最近 50 条表格 + 刷新/导出按钮） |
| `/approval-ledger/data` | 同源 JSON：`{ plan, counts, records }` |
| `/approval-ledger/export` | 带 `content-disposition` 的审计报告下载（`deepwhale.approval-ledger/v1`） |
| 其他 | 404 JSON |

面板右下角有一个 "powered by dwh" 徽章，由 `renderDashboardHtml({ badgeUrl, badgeHref })` 参数控制（传 `badgeUrl: ''` 即隐藏）——二次开发时白标替换的入口就在这里。

## 目录结构

```
lib/index.js      审批监听、风险分级、台账读写、两个查询工具、webServer 路由
lib/dashboard.js  面板 HTML 模板、导出报告结构、授权状态判定
tests/test-ledger.mjs  node:test 单测（风险分级 / 读写筛选 / 三种模式 / 面板端点）
cordis.patch.yml  插件组合层：向 profile 插入 approval-ledger
icon.svg          插件图标
```

## 二次开发

```powershell
git clone https://github.com/4478sc/DSH_Monitor
cd DSH_Monitor
npm install
npm test              # node --test（自动发现 tests/ 下的用例）
```

常见改动点：

| 想改什么 | 改哪里 |
|---|---|
| 高危/中危判定规则 | `lib/index.js` 的 `HIGH_RISK_PATTERNS` / `MEDIUM_RISK_PATTERNS` / `WRITE_TOOL_HINTS` |
| 新增运行模式 | `DEFAULT_CONFIG.mode` 的取值集合 + `resolveConfig` 校验 + `apply` 里的分支 |
| 台账字段、存储后端 | `appendRecord` / `readRecords`（当前是 JSONL 追加写） |
| 面板外观、白标 | `lib/dashboard.js` 的 `renderDashboardHtml` |
| 导出报告结构 | `buildExport`（注意 `format: 'deepwhale.approval-ledger/v1'` 是协议串，改了要同步消费方） |
| 去掉商业授权框架 | `licenseStatus` / `licenseKey` 及 `/data` 返回的 `plan` 字段 |

改完重新 `npm pack` + `dsh plugin add` + 重启 DSH 即可（见上）。

## 测试

```sh
npm test
```

覆盖：风险分级（高/中/低与自定义 `denyPatterns`）、台账追加/读取/筛选/统计、`ledger` / `gate` / `auto` 三种模式的决策路径、查询与统计工具输出、面板三个端点的响应头与结构、未授权时的 `trial` 标记。CI 在 Node 20 / 22 / 24 上跑同一套用例。

## 安全边界

- 默认只读记录，**不替用户做决定**
- `gate` / `auto` 必须显式配置；`gate` 只拦"高危特征"，不是完整安全策略
- 台账只写本地文件，不上传、不联网

## 与原仓库的差异

代码主体（`lib/`、`tests/`）与上游 `v0.2.8` 完全一致，本仓库只做"能长期维护"的配套改动：

1. `package.json`：`repository` / `homepage` / `bugs` 指向本仓库，新增 `scripts.test`、`contributors`、`bugs`，`files` 补 `README.en.md`，keywords 增补 `audit-ledger` / `compliance`；`name`、`version`、依赖与 `dsh` 字段保持不变。
2. `LICENSE`：保留上游版权行，增加二次开发版权行（MIT 要求保留原声明）。
3. `README.md`：重写（上游 README 顶部标题重复了一次），补复刻声明、配置表、面板端点、目录结构、二次开发指南。
4. 新增 `.gitattributes`、`.github/workflows/test.yml`；`.gitignore` 补充本地产物。

## License

MIT © 温州深鲸智能科技有限公司（原作）· 4478sc（复刻与二次开发部分）
