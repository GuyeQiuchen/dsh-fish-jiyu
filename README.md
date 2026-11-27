# 鲫鱼（dsh-fish-jiyu）

> 聊得再久也找得回：不调模型，比模型压缩更省 token，三段式保留让内容过渡更平滑。

按时间远近把上下文投成三档：近段保原文，中段每块一行事实行，远段只剩关键词与 seq 指针。每轮从原始会话日志重新投影，不累积摘要链；被折叠的原文可用 `jiyu_search` / `jiyu_recall` / `jiyu_blocks` 按关键词或 seq 取回。

## 它做什么

上下文接近上限时，传统做法是把旧内容摘要成一段新文本。每压一次，就多一层转述，聊得越久，离原话越远。

鲫鱼不生成摘要链。它每轮从原始会话日志重新投影一次，把历史按距离分成三档渲染：

- **近段**：保留条目原文，接近原话；
- **中段**：每块一行事实行，写清标题、动过的工具、结果和收尾片段，单行有 token 上限；
- **远段**：关键词行，配一份全局关键词索引，指向块区间。

原文不会被删除，只是折叠。所以它有两个性质：不会累积失真；被折叠的内容仍可取回。

引擎和编译器都在本包：`lib/engine/`（触发、事务、保留区、surface）与 `lib/compiler/`（条目渲染、词元、噪声、检查点）。内核最初搬自 [dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc)（MIT，TsFreddie / Tingfeng），0.4.29 起由本包接管维护，`lib/vcc/` 已删除；来源与偏离见 [`docs/vcc-fork.md`](docs/vcc-fork.md)。投影（`compile()`）一直是鲫鱼自己的。

需要 DSH 内核提供的四个包：`@deepseek-ai/dsh-compaction`、`dsh-llm`、`dsh-util-values`、`@deepseek-ai/schemastery`。这四个是宿主自带的，不用单独装。

- 设计取向（改代码先读）：[docs/ORIENTATION.md](docs/ORIENTATION.md)
- 详细说明（做什么、怎么回取、限制、验证数据）：[docs/DETAIL.md](docs/DETAIL.md)
- 测试：`npm test`（169 个自动化用例，含边界与契约）；真实会话回归：`node test/acceptance.mjs [会话日志路径]`
- 校准：`JIYU_SEQ_LO=<起始seq> JIYU_SEQ_HI=<结束seq> node test/calibrate.mjs <会话目录名>`

## 取回原文

压缩只折叠，不删除；原文都在会话日志里，三个只读工具负责把它取回来。它们不触发压缩、不改投影，删掉只是少了取回通道。

| 工具 | 用途 |
| --- | --- |
| `jiyu_search(query, limit, all)` | 按关键词在被压缩的原文里搜，返回 `seq` 和摘录，并标注「已折叠 / 在窗口内」 |
| `jiyu_recall(from, to, offset, maxChars)` | 按 `seq` 区间读回原文，默认 6000 字一页，页尾给下一页的 `offset` |
| `jiyu_blocks(tier, limit)` | 列最近一次压缩的块：档位、`seq` 区间、分档理由 |

典型用法：先在 `jiyu_search` 里搜到 `seq 3550`，再用 `jiyu_recall(3550, 3550)` 读回原话。不知道 `seq` 也能用，搜索会直接给。

## 约束区

压得越久，越容易把「必须遵守什么」折没：中段事实行还会继续折成关键词。所以检查点最前面固定一块约束区，不参与折叠。

- **只收用户原话里显式的要求**：不要 / 必须 / 改成 / 最多 / 记得 / 下次 / 回退备份这类祈使句；问句、举例、假设、事实陈述一律不抽（宁可漏，不可抽错）。
- **每行带 seq**：约束区只负责提醒，原文仍用 `jiyu_recall` 按 seq 取回。
- **上限 8 行 / 480 字符**（约 300–350 token）：禁止类与带数值的参数优先保留，超了先丢目标。
- **继承**：第二次压缩从上一份检查点里读回约束段，逐字节不变；同一件事换说法（改成/调高）时保留新说法，并在行尾注明「原 seq X 已被 seq Y 改」。
- 抽不到就是空串，一个字不占；不改变原有行为。

模拟测试（拿真实会话当题库，含人工标注的正负例）：

```sh
node scripts/sim-constraints.mjs [会话日志路径]
node test/integration-constraints.mjs [会话日志路径]
```

## 装

```sh
# Windows
.\install.ps1

# macOS / Linux
./install.sh
```

脚本会把包**复制**进 profile 的 `node_modules`，同时在 profile 自己的 `local-packages/` 里留一份副本（依赖指向这份副本，所以你下载的目录之后可以删掉、挪走），并在 `package.json` 里挂上依赖和 bundle 项，关掉它替代的 vcc 引擎；改之前两份文件都带时间戳备份。装完重启 DSH。

用别的 profile 名：`.\install.ps1 -Profile other` 或 `PROFILE=other ./install.sh`。

**手动安装时也一样：装 tgz，或者复制成真目录；不要 `dsh plugin add <目录>`。** 目录安装会写成 `link:`，包就留在原地（例如工作区），而宿主只为物理住在 profile 里的包解析 `@deepseek-ai/*`——症状是插件外壳加载了、引擎静默不激活，或者重启后报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/schemastery`（2026-11-26 在 Android 上复现过）。

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

- **0.4.5（2026-11-23）**：新增约束区（`lib/constraints.js`，可整块删除）。检查点最前固定一块「仍有效的要求」，只抽用户显式祈使句、每行带 seq、上限 8 行 / 480 字符，二次压缩逐字节继承、换说法时留痕。实测：真实会话 423 条用户消息中抽 7 条（人工标注 7 正例全中、0 误抽）；约束区约 300 token，占 33 万上下文的 0.1%。问句与事实陈述不抽是刻意的取舍。
- **0.4.4（2026-11-22，审计后）**：
  - **取回工具**修两处真问题：`textOfEvent` 原先认不出宿主真实事件形状（正文在 `data.message.content`），助手消息和工具结果全都读不到（实测 956 条助手消息 0 条可读）；分页的跳过与写入用了两套字符口径，会整条漏事件。现在覆盖 959/960 助手消息、758/758 工具结果，分页逐页收集等于区间全集。
  - **投影**：预算紧时原来会把中段/远段整段丢掉、块连 seq 都不剩，报告却写「保留了」；现在每块至少留一行指针，全局索引也保住，代价从近段原文里出。报告统计改成按真发出去的行数。
  - **性能**：关键词按块缓存、保留块数改二分搜索，263 块真实会话的验收从 24.6s 降到 3.0s。
  - **Windows**：`uninstall.ps1` 的正则开了 `(?s)`，会把 jiyu 块之后的所有配置一起删掉；`install.ps1` 重复插条目、写 BOM、junction 不清理、阈值写 0.55——都已修。
  - **其他**：`Math.min(...seqs)` 上万条目会爆栈改 `reduce`；报告改原子写；`SETTINGS_NAMESPACE` 改为读子类；bundle 同时关掉 `compaction-basic`（非 web profile 会撞服务名）；补 `engines`；文档命令与事实对齐。

- **0.4.3（2026-11-22）**：新增原文取回工具 `jiyu_search` / `jiyu_recall` / `jiyu_blocks`（`lib/recall.js`，只读，可整块删除）；补上「文档说有 recall，实际没有这个工具」的缺口。压缩投影一行未动。
- **0.4.2**：修 `markAlive` / `recordLoadError` 缺 `writeFileSync`、`path`、`homedir` 的导入；报告加 `seqFrom` / `seqTo`。
- **0.4.1**：初版。
