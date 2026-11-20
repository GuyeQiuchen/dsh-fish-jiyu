# 鲫鱼（dsh-fish-jiyu）

按时间远近把上下文投成三档的压缩引擎：**近段保原文、中段一行事实、远段只剩关键词和 seq 指针**，每轮从原始会话日志重新投影，所以不会叠摘要链；压掉的原文都能按 seq 或关键词取回。

自带引擎和编译器：`lib/vcc/` 是从 [dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc)（MIT，TsFreddie / Tingfeng）搬进来的代码，**不需要另装 vcc**。触发时机、保留区、事务回滚、surface 协议沿用它的做法，投影那一步（`compile()`）是鲫鱼自己的；条目由本引擎按放宽的尺度自己编，所以近段接近原话。

需要 DSH 内核提供的四个包：`@deepseek-ai/dsh-compaction`、`dsh-llm`、`dsh-util-values`、`schemastery`。这四个是宿主自带的，不用单独装。

- 详细说明（做什么、怎么回取、限制、验证数据）：[docs/DETAIL.md](docs/DETAIL.md)
- 测试：`node test/jiyu.test.mjs [会话日志路径]`
- 校准：`node test/calibrate.mjs <会话目录名> [起始seq] [结束seq]`

## 装

```sh
# Windows
.\install.ps1

# macOS / Linux
./install.sh
```

脚本会把包**复制**进 profile 的 `node_modules`，在 `package.json` 里挂上依赖和 bundle 项，并关掉它替代的 vcc 引擎；改之前两份文件都带时间戳备份。装完重启 DSH。

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
