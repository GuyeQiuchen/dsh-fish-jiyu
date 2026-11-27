# 0.4.31 — 报告说真话 + 三处合并前必修

代码审查（三路）核实后修掉的功能项；注释与品牌清理留到合并时。

## 1. 生产到底跑哪条路径：钉死为 time

`resolveConfig` 的返回体里没有 `engine`（也没有 `nearShare/farShare/factCap/keywordCap`），
所以 `cordis.patch.yml` 里写过的 `engine: plan` 从 0.4.22 起**从未生效**，线上一直是 time。

- profile 的 `engine: plan` 已删（改为注释说明）；
- `test/jiyu.test.mjs` 默认路径回到 `time`，plan 用 `--engine=plan` 离线对照。

## 2. 报告的 after 不再被覆盖

`makeReport` 原来优先取 `stats.tokens`，把调用方传的 `after` 覆盖掉；而 `stats.tokens`
只是投影四档之和，不含约束区与会话提醒。现在以 `after` 为准，并把这两项单独记账
（`summary.constraintTokens` / `summary.alertTokens`），报告可以自证：
**四档 + 约束 + 提醒 = 压后**。

## 3. 报告的 shadowed 不再恒 null

`base.compile()` 的返回里没有 `shadowedRange`（它由事务提交后补上），
之前写 `result?.shadowedRange` 永远拿到 undefined。现在用 `prepared` 上的真实区间与 token。

## 4. 重复安装自检修好

`shadow-check.js` 少退了一层目录（只到 `包/lib`），`current` 恒 false；
扫描名单也没有 `dsh-fish-jiyu`。整条「装了两份、升了像没升」的警告因此从未触发过。
现在能从 profile 里认出自己（实测：`dsh-fish-jiyu=0.4.30(当前)`）。

## 5. 空值判断早于解引用

`base.js` 的 `resolveModelInfo(...).context` 改成先接对象再取字段，
不然返回 undefined 时抛的是 TypeError，走不到准备好的配置错误。

## 验证

| 项 | 结果 |
|---|---|
| 新增 `test/report-truth.test.mjs` | 3 条（after 真值、两项单独记账、自检认出自己） |
| 全量测试 | **158/158** |
| 真实会话验收 | ALL PASS（time 路径） |

## 还留在合并清单

- `index.js`、`docs/DETAIL.md`、`cordis.patch.yml`（包内）里指向 `lib/vcc/` 与 `compaction-vcc` 的说明；
- golden 只覆盖 assistant/tool 三类，user 与 checkpoint 正文没被锁；
- 噪声正则不带 `g`（一条消息多个提醒只剥第一个，与旧 vcc 同）；
- `stats.keep` 在预算裁剪后仍报请求值；`midMax` 读了没用；`entryText` 死导出。
