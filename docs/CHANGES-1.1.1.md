# 1.1.1（2026-11-28）

小改：包自带的 `cordis.patch.yml` 不再写 `engine: plan`。

1.1.0 删掉二分后，plan 已是唯一引擎、也是默认值（`resolveEngineMode(undefined) → "plan"`）。
模板里再写一遍等于告诉读者「还有第二条路可选」，所以删掉键和那段旧注释。

本机 profile 的 `compaction-jiyu` 也同步删掉了 `engine`；两边都不写，行为仍由默认值保证是 plan。

## 验证

```
node --test test/*.test.mjs   169/169
tar 内 cordis.patch.yml       无 engine 键
包内 test/golden              仍不随包（0 个真实会话 fixture）
```
