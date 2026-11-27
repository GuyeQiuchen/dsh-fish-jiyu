# 合并核对单（按过往计划逐条对）

> 来源：`projects/engine-swap-plan.md`（合并门槛五项）、`projects/engine-rewrite.md`（六条硬标准 + 七条验收）、
> 以及本次会话里「合并时清」的清单。
> 规则：每条写「计划怎么说的」「实际做到哪」「证据 / 缺什么」。

更新时间：2026-11-27 14:45（+08）

## 一、合并门槛（engine-swap-plan.md）

- [ ] **M1. dry-run 影子通道（在进程内跑，只在旧引擎真要压的那一次）**
  计划：`JIYU_SHADOW=1`，算一遍不碰 surface，结果落 `shadow-report.json`。
  实际：**换成了离线工具** `tools/shadow-compare.mjs`（对 0.4.28 tgz 比 7 项）。
  偏离理由：离线能覆盖同样的比对面，且不增加线上风险；但**没有「真压那一刻的进程内影子」**。
  证据：`node tools/shadow-compare.mjs …` → 7 项全 PASS。

- [ ] **M2. 影子对账 ≥3 次真实压缩**
  实际：**0 次**。新引擎上线后一次真实压缩都还没发生（报告停在 00:46）。
  缺：等真实压缩。合并后观测。

- [ ] **M3. 五场景故障注入离线各过**
  | 场景 | 状态 | 证据 |
  |---|---|---|
  | 压力触发（成功/失败） | ✅ | `test/fault.test.mjs` |
  | 溢出恢复（成功/超限/失败） | ✅（监听器层） | 同上 |
  | 暂缓 | ✅ | 同上 + `lib/hold.js` |
  | 异常回滚 | ❌ | 属宿主事务，未演练 |
  | 连压两次 | ❌ | 只做过离线模拟（同预算幂等），线上未验 |
  另补：配置错误去重、`auto=false`、重试计数清理、坏配置拒绝，均 ✅。

- [ ] **M4. 受控失败演练（副本 profile 上重放会话，真压真写，人为抛错一次）**
  实际：**未做**。缺：副本 profile + 重放脚本 + 一次故意失败。

- [x] **M5. 回归：139 条测试 + golden**
  证据：`tests 159 / pass 159 / fail 0`；golden `7,057 条，不一致 0`。

- [x] **M6. 取回率 ALL PASS（零改写、每块有落脚点）**
  证据：`node test/acceptance.mjs … --engine=plan` → ALL PASS；取回率 326/336；0 未覆盖；
  `--engine=time` → 333/343。

## 二、六条硬标准（engine-rewrite.md）

- [ ] **H1. 一个文件一件事（`index.js` < 100 行；抄来的一律搬走）**
  实际：`index.js` **507 行**；抄来的已经搬进 `lib/engine/`（vcc 目录已删）。
  缺：拆接线板（引擎子类、报告、约束、钩子混在一起）。

- [ ] **H2. 依赖单向（每层一条 import 方向测试）**
  实际：只有两条——宿主只许 `lib/host.js`、`index.js` 只许从 `api.js` 进投影。
  缺：compiler / report / constraints / recall 各层的方向测试。

- [ ] **H3. 没有死代码（`experiments/` 以外没有未被 import 的文件）**
  实际：有——`entryText` 死导出、`midMax` 读了没用、`hasSessionEventAccess` 无人调用、
  `DRAFT_TYPES` 只在本文件用。见合并时清 Q6/Q7。

- [ ] **H4. 接口写文档（每层一份 `CONTRACT.md`）**
  实际：只有 `lib/engine/CONTRACT.md` 一份。
  缺：`lib/compiler/`、`lib/report.js`、`lib/recall.js`、`lib/constraints.js`。

- [x] **H5. 行为等价（换骨架前后同一会话输出逐字节比对）**
  证据：影子 7 项全 PASS（编译 7,598 条逐字节、投影与 stats 一致）。

- [ ] **H6. 每层能单测（骨架不依赖宿主也能跑假事件流）**
  实际：`test/fault.test.mjs` 用假 ctx 跑通了监听器层；事务/surface 未脱宿主。

## 三、合并时清（Q1–Q9）

- [x] Q1 注释/文档/日志里的 `lib/vcc/`、`compaction-vcc:` 品牌（0.4.34）
  证据：`grep -rn "lib/vcc" README.md docs/DETAIL.md cordis.patch.yml` → 只剩「已删除」这种历史陈述
- [x] Q2 `base.js` JSDoc 的 checkpointCap 默认值（65536 → 393216）
- [x] Q3 调试行 `source=` 改为按 `_settingsMounted` 判断
- [x] Q4 golden 扩到 user / checkpoint：新增 `test/golden/full-afac32c7.json`（9,892 条）
  证据：`check … full-afac32c7.json` → `9,892 条，不一致 0`
- [x] Q5 噪声正则带 `g`
  证据：`a<system-reminder>x</…>b<…>y</…>c` → `[user]\nabc`
- [x] Q6 `stats.keep` 报实际值，另加 `keepRequested`
  证据：影子对照断言 `keep ≤ keepRequested`
- [x] Q7 删 `entryText`、`midMax`
- [x] Q8 `load-error.txt` 与报告同口径（优先 `DSH_HOME`）
  证据：`test/portability.test.mjs` 3/3
- [x] Q9 预设自检认得本包（`dsh-fish-jiyu` / `compaction-jiyu`）

## 四、计划里被后续决定覆盖的（不算欠账，但要记）

| 计划 | 后来的决定 |
|---|---|
| 目录叫 `lib/skeleton/` | 实际叫 `lib/engine/`（盒子 11-26 就立了） |
| 留 `experiments/vcc/` 抄本作对照 | 抄本没留；对照改用已发布 tgz（`tools/shadow-compare.mjs`） |
| 拆 `linear.js` | 11-27 01:1x 决定不拆（盒子内自由） |
| 先写骨架再接编译 | 实际顺序：编译 → 引擎，各自用 golden/tgz 当尺子 |

## 五、结论

**合并门槛 6 项：过 2 项（M5、M6），部分 2 项（M1、M3），未做 2 项（M2、M4）。**
**六条硬标准：过 1 项（H5），其余 5 项未达。**
**合并时清 9 项：全部做完（0.4.34）。**

按「清单 + 证据」的规矩，这还不算「合并做完了」。
