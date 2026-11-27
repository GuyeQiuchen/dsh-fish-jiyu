# lib/vcc/ 的来源、偏离与维护约定

这份文件只干一件事：说清 `lib/vcc/` 那六个文件从哪来、我们改过哪几处、以后宿主变了怎么跟进。

## 一、来源

| 项 | 值 |
|---|---|
| 上游 | `dsh-compaction-vcc@0.7.4`（npm 包，MIT，作者 TsFreddie / Tingfeng） |
| 搬入方式 | 源码整文件复制，不做构建 |
| 搬入目的 | 鲫鱼自带引擎和编译器，使用者不必另装 vcc |
| 核对时间 | 2026-11-22，用 `npm pack dsh-compaction-vcc@0.7.4` 解包后逐文件 diff |

文件对应关系：

| 本仓库 | 上游 |
|---|---|
| `lib/vcc/engine.js` | `src/index.js` |
| `lib/vcc/compiler.js` | `src/compiler.js` |
| `lib/vcc/region.js` | `src/region.js` |
| `lib/vcc/preset-check.js` | `src/preset-check.js` |
| `lib/vcc/shadow-check.js` | `src/shadow-check.js` |
| `lib/vcc/session-compat.js` | `src/session-compat.js` |

## 二、我们的偏离（截至 2026-11-22）

功能改动只有 **1 处**，其余都是文件头的署名注释。

| 文件 | 改动 | 类型 | 为什么 |
|---|---|---|---|
| 六个文件 | 头部加 3 行中文注释（来源、目的、需手动同步） | 注释 | MIT 署名 + 提醒后来者 |
| `engine.js` | `settings.register` 的命名空间与 schema 改用 `this.constructor.*`，回退到基类常量 | **功能** | 基类构造里硬编码 `'compaction-vcc'`，子类的 `static SETTINGS_NAMESPACE` 不生效，鲫鱼会与真 vcc 抢同一个设置键 |

实测 diff 结果（2026-11-22）：

- `compiler.js` / `region.js` / `preset-check.js` / `shadow-check.js` / `session-compat.js`：差异仅为文件头 4 行；
- `engine.js`：文件头 4 行 + 一处功能改动（4 行注释 + 2 行代码）。

以后每次动 `lib/vcc/`，就在上表追加一行：文件、改了什么、为什么、日期。

## 三、我们依赖宿主的接口（共 23 个）

导入（12）：

- `@deepseek-ai/dsh-compaction`：`CompactionEngine`、`CompactionId`、`ManualCompactionError`、`compactCheckpointSource`、`toolPairingBalancedBefore`、`toolPairingBalancedAfter`
- `@deepseek-ai/dsh-llm`：`CONTEXT_WINDOW_EXCEEDED_CODE`、`createUserMessage`、`errorChain`
- `@deepseek-ai/dsh-util-values`：`assertNever`、`deepFreeze`
- `@deepseek-ai/schemastery`：默认导出

运行时成员（11）：

- `session.append` / `snapshotEvents` / `eventAt` / `surface` / `requestHeader` / `deriveEventMessage`
- `ctx.compaction` / `ctx.sessions.flush` / `ctx.logger` / `ctx.on` / `ctx.get`

## 四、维护约定

1. **不合并上游的功能改动。** 我们的投影是三档 + 覆盖率保底，和 VCC 原始假设不同；他们的功能性提交假设的是另一套流程，盲摘会变成两套逻辑打架。
2. **看宿主，不看 VCC。** 宿主开源（`github.com/deepseek-ai/deepseek-harness`，MIT），升级前只看三个目录的提交：
   ```sh
   git log --oneline <上次基线>..HEAD -- \
     packages/compaction packages/core/session packages/llm
   ```
   没有相关提交就只跑第五节的验证；有，再读 diff。
3. **基线记录。** 搬入时宿主为 `@deepseek-ai/* 0.2.2-rc.1`（仓库 commit `d98f5d6`）。
4. **不熟的部分先别动。** 真要考虑替换，按 `preset-check` / `shadow-check` → `session-compat` → `region` → `compiler` → `engine` 的顺序逐块换，每块用真会话与旧版 A/B。

## 五、验证（每次升级宿主后必跑）

1. `dsh --profile web --dump-config` 里 `compaction-jiyu` 恰好 1 条，且 `compaction-basic` 为 `disabled: true`；
2. 合成会话能 `compile()` 成功（含 tool/call 与 tool/result 成对）；
3. 真会话能按 seq 取回原文，且压缩报告里 `blocks = near + mid + far`（覆盖率不为 0）。

第 3 条最要紧：宿主改了语义而没改导出名时，前两条都可能正常，只有它会露馅。

## 六、为什么没有跟着上游走

上游的改动是为他们那套引擎服务的。我们只借用「引擎注册 + 会话编译」这层地基，投影、取回、报告都是自己的。跟着上游 merge，等于让别人的假设覆盖自己的设计；跟着看宿主源码，拿到的是同一份一手信息，还不会引入不匹配。

## 2026-11-27：编译器已换掉

`lib/vcc/compiler.js` 不再被生产代码引用（条目渲染、词元估算、噪声剥除、检查点折叠都在 `lib/compiler/`）。
引擎 `lib/vcc/engine.js` 仍在用。等引擎也换完、确认零引用后再删本目录并撤许可声明。

## 2026-11-27：引擎也搬进来了，lib/vcc 已删除

`lib/engine/` 里的 `base.js`、`region.js`、`preset-check.js`、`shadow-check.js`、`session-compat.js`
是 vcc 引擎内核的移植：行为未改，只把 `@deepseek-ai/*` 的 import 收敛到 `lib/host.js` 一处。
编译器的同名实现已在 0.4.27 换成 `lib/compiler/`（自己写的）。

许可：本目录的移植代码仍属 MIT 派生，`LICENSE` 与本文保留署名；README 的产品文案不提 vcc。
影子对照：`tools/shadow-compare.mjs` 用 0.4.28 的 tgz 当基线，比配置解析、引擎形状、编译与投影。
