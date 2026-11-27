# 0.4.33 — 逐项核实后的两处对齐

把 0.4.26 以来的每一条改动按命令输出逐项核实，发现两处「说了但没对齐」。

## 1. 插件介绍的中文文案与 README 不是同一句

`locale/zh.json` 里是「聊天再长也能找回：不调用模型…三档保留让内容衔接更平滑」，
README 与 `docs/CHANGES-0.4.26.md` 里是「聊得再久也找得回：不调模型…三段式保留让内容过渡更平滑」。

不是错字，是两版措辞并存。现在统一成 README/变更记录那一版（英文版本来就是它的直译）。

## 2. 验收脚本的默认路径又不是生产了

0.4.31 把默认从 plan 改回 time（当时认定生产是 time），0.4.32 又把生产切回 plan，
脚本没有跟着回。核实脚本抓到的正是这一条：**默认路径与生产不一致，验收会验错对象**。

现在默认 `plan`，要对照旧路径用 `--engine=time`。

## 核实结果（其余全绿）

| 版本 | 声明的改动 | 核实方式 | 结果 |
|---|---|---|---|
| 0.4.26 | 文案、README 安装提示 | 读文件比对 | ✅（中文描述已对齐） |
| 0.4.27 | 编译器换 `lib/compiler/`、`lib/vcc` 删除 | `grep` + `compiler.test.mjs` + golden | ✅ |
| 0.4.28 | 报告 blocks/summary 同口径 | `grep "let placed = tier"` | ✅ |
| 0.4.29 | 引擎搬入、宿主依赖收敛 | `boundary.test.mjs`、`shadow-compare` | ✅ |
| 0.4.30 | 落点开区间 | `coverage.test.mjs` | ✅ |
| 0.4.31 | after/shadowed/自检/空值 | `report-truth.test.mjs` | ✅ |
| 0.4.32 | plan 接线 | `resolveConfig` 实测、配置双份 | ✅ |

全量测试 159/159；真实会话验收（默认 plan）ALL PASS。
