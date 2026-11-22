# 鲫鱼（dsh-fish-jiyu）

按时间远近把上下文投成三档的压缩引擎：**近段保原文、中段一行事实、远段只剩关键词和 seq 指针**，每轮从原始会话日志重新投影，所以不会叠摘要链；压掉的原文都能用自带工具按 seq 或关键词取回（`jiyu_search` / `jiyu_recall` / `jiyu_blocks`）。

自带引擎和编译器：`lib/vcc/` 是从 [dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc)（MIT，TsFreddie / Tingfeng）搬进来的代码，**不需要另装 vcc**。触发时机、保留区、事务回滚、surface 协议沿用它的做法，投影那一步（`compile()`）是鲫鱼自己的；条目由本引擎按放宽的尺度自己编，所以近段接近原话。

需要 DSH 内核提供的四个包：`@deepseek-ai/dsh-compaction`、`dsh-llm`、`dsh-util-values`、`@deepseek-ai/schemastery`。这四个是宿主自带的，不用单独装。

- 详细说明（做什么、怎么回取、限制、验证数据）：[docs/DETAIL.md](docs/DETAIL.md)
- 测试：`node test/jiyu.test.mjs [会话日志路径]`
- 校准：`JIYU_SEQ_LO=<起始seq> JIYU_SEQ_HI=<结束seq> node test/calibrate.mjs <会话目录名>`

## 取回原文

压缩只折叠，不删除；原文都在会话日志里，三个只读工具负责把它取回来。它们不触发压缩、不改投影，删掉只是少了取回通道。

| 工具 | 用途 |
| --- | --- |
| `jiyu_search(query, limit, all)` | 按关键词在被压缩的原文里搜，返回 `seq` 和摘录，并标注「已折叠 / 在窗口内」 |
| `jiyu_recall(from, to, offset, maxChars)` | 按 `seq` 区间读回原文，默认 6000 字一页，页尾给下一页的 `offset` |
| `jiyu_blocks(tier, limit)` | 列最近一次压缩的块：档位、`seq` 区间、分档理由 |

典型用法：先在 `jiyu_search` 里搜到 `seq 3550`，再用 `jiyu_recall(3550, 3550)` 读回原话。不知道 `seq` 也能用，搜索会直接给。

## 装

```sh
# Windows
.\install.ps1

# macOS / Linux
./install.sh
```

脚本会把包**复制**进 profile 的 `node_modules`，同时在 profile 自己的 `local-packages/` 里留一份副本（依赖指向这份副本，所以你下载的目录之后可以删掉、挪走），并在 `package.json` 里挂上依赖和 bundle 项，关掉它替代的 vcc 引擎；改之前两份文件都带时间戳备份。装完重启 DSH。

用别的 profile 名：`.\install.ps1 -Profile other` 或 `PROFILE=other ./install.sh`。

**必须是真目录，不能是符号链接或 junction。** 宿主只为物理住在 profile 里的包解析 `@deepseek-ai/*`；链接能加载，但引擎会静默不激活（2026-11-19 在 Windows 上验证过）。又因为依赖写成 `link:`，pnpm 下次装任何插件都会把它改回链接——所以之后再装插件，重跑一次这个脚本。

卸载：`.\uninstall.ps1` 或 `./uninstall.sh`。

三档长这样：

```
近段  你：这根线接在哪 ← 原文保留
中段  [块 seq 3323-3325 · 23:16] 「你看过鲟鱼失忆的原因…」 · 收尾「…」 · 原文按 seq 取回
远段  [块 seq 9-44] 词：风扇 bug 修复 扇设定数
索引  [关键词索引] bug→9-44,2774-2776; 风扇→9-44,2680-2703; …
```

为什么叫鲫鱼：鲫谐音「记」；鱼记性差本来就是个梗，所以干脆不指望它记住——原文全留在日志里，靠 seq 指针回去取。

## 变更

- **0.4.4（2026-11-22，审计后）**：
  - **取回工具**修两处真问题：`textOfEvent` 原先认不出宿主真实事件形状（正文在 `data.message.content`），助手消息和工具结果全都读不到（实测 956 条助手消息 0 条可读）；分页的跳过与写入用了两套字符口径，会整条漏事件。现在覆盖 959/960 助手消息、758/758 工具结果，分页逐页收集等于区间全集。
  - **投影**：预算紧时原来会把中段/远段整段丢掉、块连 seq 都不剩，报告却写「保留了」；现在每块至少留一行指针，全局索引也保住，代价从近段原文里出。报告统计改成按真发出去的行数。
  - **性能**：关键词按块缓存、保留块数改二分搜索，263 块真实会话的验收从 24.6s 降到 3.0s。
  - **Windows**：`uninstall.ps1` 的正则开了 `(?s)`，会把 jiyu 块之后的所有配置一起删掉；`install.ps1` 重复插条目、写 BOM、junction 不清理、阈值写 0.55——都已修。
  - **其他**：`Math.min(...seqs)` 上万条目会爆栈改 `reduce`；报告改原子写；`SETTINGS_NAMESPACE` 改为读子类；bundle 同时关掉 `compaction-basic`（非 web profile 会撞服务名）；补 `engines`；文档命令与事实对齐。

- **0.4.3（2026-11-22）**：新增原文取回工具 `jiyu_search` / `jiyu_recall` / `jiyu_blocks`（`lib/recall.js`，只读，可整块删除）；补上「文档说有 recall，实际没有这个工具」的缺口。压缩投影一行未动。
- **0.4.2**：修 `markAlive` / `recordLoadError` 缺 `writeFileSync`、`path`、`homedir` 的导入；报告加 `seqFrom` / `seqTo`。
- **0.4.1**：初版。
