# 1.0.1（2026-11-27）· 定版

1.0.1 = 0.4.34 之后这一轮的修复结果。0.4.26 → 0.4.34 的改动见各版本 CHANGES；
本文件只记「0.4.34 → 1.0.1」这一轮，以及发版前两份审查（规整 / 缺陷）的处理结论。

## 修掉的缺陷（都有复现）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| B1 | `lib/plan.js:54`、`lib/linear.js` | plan 把每块「垫底指针」按关键词行计价（36.8 vs 13.0 token），块多时判定「连垫底都装不下」，返回 k=0——**一条原文都不留**（2000 块实测：time 留 274 块原文，plan 留 0） | 指针按真实指针价估；重定价那遍若退回 k=0，回退到第一遍的 k |
| B2 | `lib/linear.js` | 每块落脚点在裁剪**之后**无条件补，补多少不复核 → 压完超目标 10.9%；cap 小时超 91% | 把「补齐每块落脚点」的价钱算进预算，裁的每一步都带着指针；指针都装不下时才停止让步 |
| B3 | `lib/linear.js` | 报告 `blocks` 记「计划档位」，指针行被算成事实行（summary 写 mid 0/far 0，报告 117 块全是事实行） | 按最终输出的真实行重新定档：词行=2 / 事实行=1 / 只剩指针=0 |
| B5 | `lib/linear.js` | `stats.keep` 把只剩指针的块也算「保住了原文」（keep 报 10，实际原文 1 条） | 只数真留下原文条目的块 |
| B6 | `lib/linear.js` | `indexWords` 报索引表大小（242），索引行只印 24 个词 | 报真印出来的词数（`INDEX_LIMIT`） |
| B8 | `lib/recall.js` | 报告 `blocks` 只有被折的块，近段块被标成「在窗口内」 | 表格为空时用 `shadowed` 完整区间兜底 |
| B9 | `lib/compiler/tokens.js` | `truncateWords` 按空格分词数上限，CJK/长串会超（limit=10 出 17 token） | 用真估算器复核，超了二分往回切；小预算改用单字符省略号保住正文 |
| B10 | `lib/linear.js` | `short()` 按 UTF-16 切片，能切出半个 emoji | 按码点切 |
| B11 | `lib/compiler/render.js` | 硬截断条件 `entries.length === 1` 永远不成立（前面必有 elided 标记） | 改为「压最大的一条」；cap 小到只剩标记时清空正文 |
| B12 | `lib/recall.js` | offset 落在行中间时整行再交付一遍 | 跳过该行余下部分，页与页之间不重不漏 |

## 规整项

- 删掉 `index.js` 里永远不成立的 `no-compiler` 分支；
- `tools/window-compare.mjs` 指向已搬走的 `experiments/window.js`（之前 import 失败）；
- `test/jiyu.test.mjs` → `test/acceptance.mjs`：它以前无参时 `exit 0`，被 `node --test` 记成
  1 个「通过」——160/160 里混着一个什么都没断言的文件。改名后测试数 **169**，全是真的；
- 两个零引用导出（`COMPACTION_SERVICE`、`hasSessionEventAccess`）收回内部；
- 影子对照工具改为「契约门 + 信息项」：配置/原型/命名空间必须一致；条目与 stats 的差异
  作为 INFO 记录（截断修复导致），不再当失败。

## 验证

| 项 | 结果 |
|---|---|
| 全量测试 | **169 / 169** |
| golden（全角色，10,292 条） | 0 差 |
| golden（legacy，7,987 条） | 0 差 |
| 影子对照（对 0.4.28） | 契约全过；条目差异 215 条（截断修复） |
| 真实会话验收 · plan | ALL PASS（0 未覆盖，取回率 343/353） |
| 真实会话验收 · time | ALL PASS（0 未覆盖，取回率 354/364） |
| 2000 块压力（B1/B2 复现） | 两引擎都 ≤ 目标；plan 留 264 条原文 |

## 已知限制（不是本轮修的）

1. **引擎骨架仍是 dsh-compaction-vcc 0.7.4 的原样副本**（2,179 行，只改 import 与文件头）。
   重写骨架属另一件事，需单独立项与验收。
2. `index.js` 仍 517 行、混着 8 类职责（拆它要动加载链，放在 1.0.2）。
3. 每层 CONTRACT 只有 `lib/engine/CONTRACT.md` 一份。
4. 触发线按 checkpointCap（393,216）× 0.35 算，不是按模型窗口（1,048,576）；
   这是有意为之（压早、留余量），改动会显著增加每轮 token。
5. `nearShare` 只对 time 路径生效；plan 的原文份额由预算自然决定。
