# 0.4.34 — 合并时清：Q1–Q9

按 `docs/MERGE-CHECKLIST.md` 的清单，把「合并时清」的九项一次做完。行为只在
三处有意改变（噪声全剥、`keep` 报真值、预设自检认得本包），其余是文案与死代码。

| 项 | 改了什么 |
|---|---|
| Q1 | `index.js` / `base.js` / `DETAIL.md` / `cordis.patch.yml` 里指向 `lib/vcc/`、`compaction-vcc:` 的说明与日志前缀，改成现状；设置命名空间 `compaction-vcc` 与 `COMPILER_PROVIDER` **故意不动**（前者是配置键，改了会丢用户设置；后者是溯源标识） |
| Q2 | `effectiveMaxTokens` 的 JSDoc 写 65536，改回 393216 |
| Q3 | 调试行 `source=` 原来恒取 settings，改成按 `_settingsMounted` 真实判断 |
| Q4 | **golden 扩到 user / checkpoint 正文**：新增 `test/golden/full-afac32c7.json`（9,892 条，原 7,057 条只有 assistant/tool）。旧 golden 用 `--legacy-rows` 仍可复核 vcc 时代那批行 |
| Q5 | 噪声正则加 `g`：一条消息里多个 `<system-reminder>` 现在全剥（实测 `a…b…c` → `abc`） |
| Q6 | `stats.keep` 改报**实际保住的块数**，另加 `keepRequested` |
| Q7 | 删死导出 `entryText`；`linear.js` 里读了不用的 `midMax` 一并去掉 |
| Q8 | `load-error.txt` 与报告同口径：有 `DSH_HOME` 就写那里 |
| Q9 | 预设自检认得本包：`ENGINE_PACKAGE` = `dsh-fish-jiyu`，行 id 增加 `compaction-jiyu`（vcc / instant 仍认） |

## 验证

| 项 | 结果 |
|---|---|
| 全量测试 | 159/159 |
| golden（旧口径 `--legacy-rows`） | 7,057 条，0 差 |
| golden（全口径） | 9,892 条，0 差 |
| 影子对照（对 0.4.28） | 全过（`keep` 单独断言：实际 ≤ 请求） |
| 真实会话验收 | ALL PASS |

## 记录

`test/portability.test.mjs` 因为 Q8 改了环境口径，测试里补了 `DSH_HOME` 指向临时目录——
否则会读到宿主环境的 `DSH_HOME`，写到真实家目录去。

## 热修（2026-11-27 15:2x，版本号不变）

**线上事故**：0.4.34 加载后每一次压缩都失败，报告停在 00:46。

```
compaction/end  error: Cannot assign to read only property 'lastIndex' of object '[object RegExp]'
```

原因：Q5 给噪声正则加了 `g`，而配置对象被 `deepFreeze` 冻结；带 `g` 的正则参与
`String.replace` 时会写 `lastIndex`，冻结对象上不可写 → 每次压缩 45ms 内报错退出。

修法：`stripNoise` 每次用局部重建的正则（`new RegExp(pattern.source, flags)`），
冻结的那个只当模板。新增回归测试：冻结正则 + 一条消息两段提醒 → 全剥且不抛。

验证：全量 160/160；golden 9,892 / 7,057 均 0 差；真实会话验收 ALL PASS。
版本号仍为 0.4.34（验收候选的热修），最终发布仍为 1.0.1。
