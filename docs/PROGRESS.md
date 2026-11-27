# 进度单（鲫鱼 · 最后一次大改）

> 规矩：**只按命令输出打钩**。钩子后面必须写「证据」——文件、测试名、命令输出。
> 没有证据的项不钩；凭印象认为「应该没问题」的，一律留空。
> 更新方式：做完一件事 → 跑对应命令 → 把输出摘一行进「证据」→ 再改 `[ ]` 为 `[x]`。

更新时间：2026-11-27 14:35（+08）

## 已完成

- [x] **A. 编译器换成本包实现**（0.4.27）
  证据：`node tools/compiler-golden.mjs check …` → `golden 7057 条 / 不一致 0 条`
- [x] **B. 引擎搬进 `lib/engine/`，`lib/vcc/` 删除**（0.4.29）
  证据：`node tools/shadow-compare.mjs …` → 四项全 PASS（配置解析 / 形状 / 编译 7,307 条 / 投影）
- [x] **C. 宿主依赖收敛到 `lib/host.js`**
  证据：`test/boundary.test.mjs` → 「宿主依赖只许 lib/host.js 一处 import」通过
- [x] **D. 落脚点 off-by-one**（0.4.30）
  证据：`test/coverage.test.mjs` 2/2；复现「块 40-47 / target 500」已不再丢块
- [x] **E. 报告说真话**（0.4.31）
  证据：`test/report-truth.test.mjs` 3/3（after 真值、约束/提醒单独记账、自检认出自己）
- [x] **F. 重装自检修好**
  证据：`findInstalledCopies(profile 路径)` → `dsh-fish-jiyu=0.4.30(当前)`
- [x] **G. plan 接线**（0.4.32）
  证据：装好的那份 `resolveConfig({engine:'plan'}).engine` → `plan`；`test/fault.test.mjs` 新增 1 条通过
- [x] **H. 全量测试**
  证据：`node --test test/*.test.mjs` → `tests 159 / pass 159 / fail 0`
- [x] **I. plan 路径离线验收**
  证据：`node test/acceptance.mjs <会话> --engine=plan` → ALL PASS；920,599 → 292,809（目标 322,209，填 90.9%）；取回率 326/336；0 未覆盖
- [x] **J. time 路径离线验收**
  证据：同上 `--engine=time` → ALL PASS；916,696 → 272,624（85.0%）；取回率 333/343

## 改动逐项核实（2026-11-27 14:0x）

用脚本按文件内容与版本声明逐条比对，不凭印象。

| 版本 / 产物 | 声明 | 核实 | 结果 |
|---|---|---|---|
| 0.4.26 | 文案、README 安装提示 | 读文件比对 | 中文描述与 README 不是同一句 → **已对齐**（0.4.33） |
| 0.4.27 | 编译器换 `lib/compiler/`，`lib/vcc` 删除 | grep + `compiler.test.mjs` + golden 0 差异 | ✅ |
| 0.4.28 | 报告 blocks/summary 同口径 | `grep "let placed = tier"` | ✅ |
| 0.4.29 | 引擎搬入、宿主依赖只 `lib/host.js` | `boundary.test.mjs`、`shadow-compare` 四项 | ✅ |
| 0.4.30 | 落点开区间 | `coverage.test.mjs` 2/2 + 复现 | ✅ |
| 0.4.31 | after 真值、shadowed、自检、空值 | `report-truth.test.mjs` 3/3 | ✅ |
| 0.4.32 | plan 接线 | `resolveConfig` 实测 + 双份配置 | ✅ |
| 工具 | golden / shadow / gate | 三个文件存在且能跑 | ✅ |
| 版本一致 | 仓库 = 已装 | `package.json` 比对 | ✅ |
| 验收默认路径 | 应等于生产 | 脚本默认 `time` ≠ 生产 `plan` → **已改回 plan**（0.4.33） |

## 热修记录（2026-11-27 15:2x）

- **现象**：0.4.34 加载后压缩全部失败，报告停在 00:46；
- **证据**：会话事件 `37129` 起每次 `compaction/start` → `compaction/end`，error = `Cannot assign to read only property 'lastIndex'`；
- **根因**：Q5 的 `g` 标志 + `deepFreeze` 冻结正则 + `String.replace` 写 `lastIndex`；
- **修法**：`stripNoise` 每次重建局部正则；新增回归测试；
- **验证**：160/160、两份 golden 0 差、真实会话 ALL PASS；
- **版本**：仍为 0.4.34（候选热修），最终发布仍是 1.0.1。

## 冻结（2026-11-27 14:5x 主人决定）

> 「接下来不发新版，直到我完成验收，最终版本定为 1.0.1。」

- **发布冻结**：验收完成前**不发布新版本**；
- **代码改动**：逐次确认后可以改（例如 15:2x 那次 `lastIndex` 热修），不做「顺手一起改」；
  —— 注：2026-11-27 15:3x 主人指出，我把「不发版」扩大成了「不许改代码」，这一行已改正；
- **线上**：0.4.34（= 1.0.1 的候选）；
- **发布条件**：验收清单（`docs/ACCEPTANCE.md`）走完；
- **发布动作**：版本改 1.0.1 → 打包 → 安装 → 自检 → 发 `/sdcard/Download/DSH-Go/`。

## 合并（2026-11-27 14:35 主人决定）

> 「先合并，直接用最终版本来实测，如果有问题再回退就是了。」

**合并 = 0.4.33 作为最终版本上线**，剩余验收改为「线上观测 + 随时回退」。

合并前最后一轮核实（全绿）：

| 项 | 证据 |
|---|---|
| 全量测试 | `tests 159 / pass 159 / fail 0` |
| golden | `7,057 条，不一致 0 条` |
| 影子对照（对 0.4.28 tgz） | 7 项全 PASS；旧 25 个配置键逐字段一致；新 5 键按 0.4.32 约定 |
| 版本 | 仓库 0.4.33 = 已装 0.4.33 |

**回退已备好**：`/root/workspace/rollback-0.4.32/package`（0.4.32 解包）
回退命令：`cd /root/workspace/rollback-0.4.32/package && ./install.sh --profile web`，然后重启。

## 待做（合并门槛）

- [x] **K. 重启加载 0.4.32**
  证据：`loaded.txt` = 2026-11-27T05:53:57.424Z（本地 13:53:57），晚于配置写入 13:53:02；
  装好的包版本 `0.4.32`；`load-error.txt` 仍是 22:39 那条旧记录，无新增
- [x] **L. plan 的第一次真实压缩**
  证据：重启 15:35:25，压缩发生在 **15:35:56**；会话事件 `37458 compaction/start`
  → `37459 compaction/summary` → `37461 compaction/end`（无 error）。
  报告：seq 34344-37208，before 176,320 → after 56,450，43 块 = 原文 23 / 事实 11 / 关键词 9。
  （另：重启前 37425/37437/37448 仍有 `lastIndex` 报错，属旧进程。）
  证据要求：`node tools/compression-gate.mjs` 全过（六项）+ 报告 `at` 晚于加载时间
- [x] **M. 真实落点不顶破目标**
  证据：压后 56,450 / 目标 68,812（82.0%），`tools/compression-gate.mjs` PASS。
  证据要求：报告 `after ≤ target`，且 `after` 与「四档+约束+提醒」对得上
- [ ] **N. 真实取回与零改写**
  证据要求：`node test/acceptance.mjs <会话>` ALL PASS
- [ ] **O. 连压两次不重叠**
  证据要求：第一次压缩后再触发，报告两次 `seqFrom-seqTo` 不重叠、块数不翻倍
- [ ] **P. 五场景故障注入（真实例）**
  已有：监听器层 8 条离线通过（`test/fault.test.mjs`）
  待补：压力触发真压 / 溢出真恢复 —— 只能在真实会话里等

## 合并后观测（有问题就按上面的回退）

- 第一次 plan 真实压缩：报告 `at` 变新、六项 gate 全过；
- 落点是否 ≤ 目标（plan 的索引不计预算，可能顶破）；
- `stats.keep` 与裁后实际是否一致；
- 连压两次：两次 `seqFrom-seqTo` 不重叠、块数不翻倍。

## 合并时清（0.4.34 已全部完成）

- [x] Q9 预设自检认得本包（`dsh-fish-jiyu` / `compaction-jiyu`）

- [x] Q1 注释与文档里的 `lib/vcc/`、`compaction-vcc:` 品牌（`index.js:40/328/476`、`docs/DETAIL.md`、包内 `cordis.patch.yml`）
- [x] Q2 `base.js:793` JSDoc 写 checkpointCap 默认 65536，实际 393216
- [x] Q3 `base.js:646` 调试行 `source=` 三元恒取 settings
- [x] Q4 golden 只覆盖 assistant/tool/result，user 与 checkpoint 正文没锁
- [x] Q5 噪声正则不带 `g`（一条消息多个提醒只剥第一个；与旧 vcc 同）
- [x] Q6 `stats.keep` 在预算裁剪后仍报请求值
- [x] Q7 `midMax` 读了没用；`entryText` 是死导出
- [x] Q8 `index.js:44` load-error 写 `homedir()`，报告目录优先 `DSH_HOME`

## 之后

- [ ] R. 记忆体引擎化（盒子 + 规整 + `--verify-only` + 失败可见），见 `projects/memory-engine.md`
