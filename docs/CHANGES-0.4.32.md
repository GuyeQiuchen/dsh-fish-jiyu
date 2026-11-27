# 0.4.32 — plan 真的接上了

二分是 vcc 留下的路；plan 是本包自己的规划。0.4.22 就写了，但一直没跑起来。

## 为什么一直没跑

`resolveConfig` 里这五个键在允许名单里（`validateKeys` 不报错），却**从没被拷进返回对象**：

`engine` / `nearShare` / `farShare` / `factCap` / `keywordCap`

于是 `cordis.patch.yml` 写着 `engine: plan`，`index.js` 读 `this.config?.engine` 得到
undefined，`?? 'time'` 一路退回二分——**0.4.22 的 plan 从上线起一次都没运行过**。
0.4.24「余钱还给原文」、0.4.25「两遍计价」两次修，改的也是这条从没跑过的路。

## 改法

`resolveConfig` 按名字把五个键带出来，并校验：

| 键 | 规则 | 默认 |
|---|---|---|
| `engine` | `"time"` 或 `"plan"` | `time` |
| `nearShare` / `farShare` | (0, 1] | 0.85 / 0.15 |
| `factCap` / `keywordCap` | ≥0 整数（0 = 不裁） | 60 / 24 |

写错值现在会抛错，不再静默退回默认。

## 生产配置

`cordis.patch.yml`（包内与 profile）都写上了 `engine: plan`。

## 验证

| 项 | 结果 |
|---|---|
| 全量测试 | **159/159**（新增 1 条：五个键真的传得下去、非法值报错） |
| 真实会话验收（plan 路径） | **ALL PASS**：920,599 → 292,809（目标 322,209，填 90.9%）、0 未覆盖、取回率 326/336、零改写 |
| 对照（time 路径） | 916,696 → 272,624（85.0%）、取回率 333/343 |

plan 比 time 多留约 2 万 token 的原文，填充率 90.9% vs 85.0%——这是它「余钱还给原文」的设计结果。

## 还没验的

**plan 路径的第一次真实压缩**。此前所有 plan 数据都是离线跑的；线上第一次跑完之后要看：
落点是否 ≤ 目标、`stats.keep` 与裁后实际是否一致、连压两次是否稳定。
