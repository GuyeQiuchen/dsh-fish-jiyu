# 鲫鱼（dsh-fish-jiyu）

按时间远近把上下文投成三档的压缩引擎：**近段保原文、中段一行事实、远段只剩关键词和 seq 指针**，每轮从原始会话日志重新投影，所以不会叠摘要链；压掉的原文都能按 seq 或关键词取回。

自带引擎和编译器：`lib/vcc/` 是从 [dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc)（MIT，TsFreddie / Tingfeng）搬进来的代码，**不需要另装 vcc**。触发时机、保留区、事务回滚、surface 协议沿用它的做法，投影那一步（`compile()`）是鲫鱼自己的；条目由本引擎按放宽的尺度自己编，所以近段接近原话。

需要 DSH 内核提供的四个包：`@deepseek-ai/dsh-compaction`、`dsh-llm`、`dsh-util-values`、`schemastery`。这四个是宿主自带的，不用单独装。

- 详细说明（做什么、怎么回取、限制、验证数据）：[docs/DETAIL.md](docs/DETAIL.md)
- 安装/卸载：`install.ps1` / `uninstall.ps1`（各带时间戳备份）
- 测试：`node test/jiyu.test.mjs [会话日志路径]`
- 校准：`node test/calibrate.mjs <会话目录名> [起始seq] [结束seq]`

三档长这样：

```
近段  你：这根线接在哪 ← 原文保留
中段  [块 seq 3323-3325 · 23:16] 「你看过鲟鱼失忆的原因…」 · 收尾「…」 · 原文按 seq 取回
远段  [块 seq 9-44] 词：风扇 bug 修复 扇设定数
索引  [关键词索引] bug→9-44,2774-2776; 风扇→9-44,2680-2703; …
```

为什么叫鲫鱼：鲫谐音「记」；鱼记性差本来就是个梗，所以干脆不指望它记住——原文全留在日志里，靠 seq 指针回去取。
