# 1.1.0（2026-11-28）· 删掉二分，只留 plan

1.0.1 修好 `engine` 配置被静默丢弃之后，第一次真实压缩（11-27 16:59）走的是 plan。
按「两次真实压缩才删二分」的约定本来还差一次，但最终改为：**直接删，用离线验收补证据**。

## 删了什么

- `projectRegion` 里「从 nearBlocks 一路二分试 keep」的整段：`while (lo <= hi)`、`build(nearBlocks)` 的尝试循环、`nearShare` 判据；
- `build()` 里按引擎分叉的牺牲顺序，固定为 plan 的顺序：先远段、再事实行、最后原文；
- 两个已无意义的对照脚本：`tools/compare-engines.mjs`、`tools/plan-compare.mjs`。

## 改了什么

| 项 | 旧 | 新 |
|---|---|---|
| 默认引擎 | `time`（二分） | **`plan`** |
| `engine: 'time'` | 走二分 | 按 plan 跑，打一行弃用警告 |
| 非法 engine | 报 `must be "time" or "plan"` | 报 `must be "plan"` |
| 报告 | 不记引擎 | `last-report.json` 新增 `engine: "plan"` |

`nearShare` 仍被接受但不再影响投影（二分专用），属保留的兼容配置。

## 验证（同一份真实会话，1203 块 / 200 题 / target 98,304）

```
离线验收（test/acceptance.mjs）   ALL PASS（10/10）
  未覆盖 0
  远段关键词取回 400/411 = 97.3%
  重投影 943 块 0 改写
  压完 347,054 ≤ 382,944（默认预算）
全量测试                          169/169
```

## 为什么现在删

再等一次真实压缩只是重复同一个结论；而两条路径每天都有「改了一边忘了另一边」的风险。
证据不够的部分用离线验收补：同会话、同预算、同渲染。

## 封包

`test/` 不再随包发布：里面有两份真实会话 golden（`afac32c7.json` 5.7 MB、`full-afac32c7.json` 9.8 MB），
含本机真实对话，发布即泄露。包体因此从约 16 MB 降到几百 KB。

## 注意

- 升级后**默认就是 plan**，没配 `engine` 的机器不用改配置；
- 配了 `engine: time` 的机器会在启动/压缩日志里看到一次弃用提示，行为等同 plan；
- 想回退只能装回 1.0.1（备份：`dsh-fish-jiyu-1.0.1-pre-plan-only.tar.gz`）。
