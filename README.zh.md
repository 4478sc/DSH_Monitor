# @deepwhale-cn/dsh-approval-ledger

**审批台账**：记录 agent 每一次需要审批的操作——它想做什么、为什么、风险多高、最后批没批，并按规则拦住高危动作。

DSH 的审批是一个 waterfall 事件（`approval/request`），本插件挂一个监听器：

| 模式 | 行为 |
|---|---|
| `ledger`（默认） | **不改任何决策**，只记录：时间 / 会话 / 工具 / 调用 id / 理由 / 风险 / 决策 / 结果 |
| `gate` | 高危操作（`rm -rf`、`mkfs`、`dd`、`curl \| sh`、`sudo`、写 `.ssh`、`danger-full-access` 等）直接 `rejected`，其余交给原有回答者 |
| `auto` | `allowlist` 里的工具直接 `allowed-once`，其余照旧 |

## 安装

```sh
dsh plugin --profile <你的 profile> add @deepwhale-cn/dsh-approval-ledger
```

默认 `ledger` 模式，装上就开始记录，**不改变任何审批行为**。要启用拦截，在 profile 里配置 `mode: gate` 并重启。

## 台账位置

`$DSH_HOME/approval-ledger/ledger.jsonl`（没有 `DSH_HOME` 时用 `~/.dsh/approval-ledger/ledger.jsonl`），一行一条 JSON。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `approval_ledger_query` | 按工具/风险/决策/结果/时间查询记录 |
| `approval_ledger_stats` | 总数、高危数、被拒数，以及按风险/决策/结果/工具的分布 |

## 示例输出

```
✅ 2026-10-22 09:31:12  bash  风险 high  决策 delegated  结果 rejected
    理由：安装依赖需要执行 curl | sh
```

## 安全边界

- 默认只读记录，**不替用户做决定**
- `gate` / `auto` 必须显式配置；`gate` 只拦"高危特征"，不是完整安全策略
- 台账只写本地文件，不上传、不联网

## License

MIT © 温州深鲸智能科技有限公司
