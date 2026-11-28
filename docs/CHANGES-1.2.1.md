# 1.2.1（2026-11-28）· 安装/升级路径修复

独立审查发现两处安装缺陷，都是 1.0.1 就有的，但会挡住 1.2.0 的升级，先修。

## 修掉的

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| S1 | `scripts/setup.mjs` `validatePatch` | 只认顶层 `- id:`；真 profile 的 `- insert:`（preset 块）被判「结构不对」，安装直接失败 | 允许 `- insert:`；块内只看直接子条目的 id，更深层（preset 里的插件 id）允许重名 |
| S2 | `scripts/setup.mjs` `copyPackage` | 从 profile 自己的 `local-packages` 副本跑 setup 时，`from === storeCopy`：先 `rm(to)` 再 `cp(from)`，把源目录清空 | 路径相同则跳过复制 |
| S3 | `scripts/setup.mjs` 复制过滤 | 把 `test/`（含两真实会话 fixture，15.5 MB）也复制进 profile | `COPY_EXCLUDES` 加 `test` |
| S4 | `lib/engine/base.js` 弃用警告 | 一次构造 + 一次 reload 打 4 条，与「只提示一次」不符 | 模块级 `Set` 按 key 去重 |
| S5 | `lib/engine/CONTRACT.md`、`tools/shadow-compare.mjs`、`test/acceptance.mjs` | 仍把 engine 写成活跃键/默认 time；`--engine=time` 会打印误导信息 | 全部按弃用口径更新 |

## 验证

```
安装脚本测试       9/9
全量测试           169/169
真 profile dry-run ok patch 有效（9 条）
实装                local-packages 1.2.0 / node_modules 1.2.0
profile 体积        17 MB → 680 KB（不再复制 test）
```

安装后 profile 的 `node_modules/dsh-fish-jiyu` 才真正是 1.2.x；此前它一直是 1.0.1，
所以「重启」并不会自动加载新代码，必须先跑一次 setup。
