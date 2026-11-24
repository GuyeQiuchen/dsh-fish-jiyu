# 职责边界（2026-11-22 定）

这个包是**基底**，不是平台。只做压缩，不加别的能力。

## 我负责

1. 在上下文接近上限时把它压小：近段原文、中段事实行、远段关键词 + seq 指针；
2. 压掉的原文能取回：`jiyu_search` / `jiyu_recall` / `jiyu_blocks`；
3. 每次压缩留一份决策报告，供诊断和别的插件读。

## 我不负责

记忆、人格、主动性、成长、提醒、任务调度、界面玩法。这些做在别的插件里；它们依赖下面两个口，不依赖本包内部实现。

## 对外提供（稳定接口）

| 接口 | 内容 | 谁用 |
|---|---|---|
| 压缩后端 | `ctx.compaction` 的引擎，条目含 seq，可被宿主折成检查点 | 宿主 |
| 取回工具 | `jiyu_search` / `jiyu_recall` / `jiyu_blocks` | 模型、其他插件 |
| 报告文件 | `~/.dsh/fish-jiyu/reports/<session>.json`（数组，最新在前）与 `last-report.json`；字段：`at / session / before / after / cap / target / seqFrom / seqTo / summary{blocks,keep,near,mid,far,indexWords} / blocks[{seq,tier,tierName,reason}]` | 记忆体（压缩线）等 |

**报告字段是接口，不是实现细节**：只增不改——加字段随便，改字段名或语义算破坏性变更。

必有的顶层字段（缺一个就是坏）：

```
at session provider cap target before after ratio
seqFrom seqTo summary blocks
```

`blocks[]` 里每项必有 `seq tier tierName reason`；`summary` 必有 `blocks keep near mid far indexWords`。
`constraints` 是可选字段（没有约束区时为 null）。

这条由 `test/report-schema.test.mjs` 钉住：谁改名，测试红。

## 冻结（保留现状，不删不改不加）

- `jiyu_hold`（暂缓）：属于节奏控制，不属于压缩；
- 面板 `view.js` / `client.js`：手机端看不到，留着不影响。

## 什么算 bug

三条同时满足才算：**能复现**（步骤或输入）、**有验收**（修完怎么证明）、**属于本包职责**。

只满足前两条、但属于「压缩得不够聪明」「压得太频繁」这类取舍，不算 bug，记进 `docs/DETAIL.md` 的已知限制。
