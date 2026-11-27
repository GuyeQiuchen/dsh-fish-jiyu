# 0.4.29 — 引擎搬进来，lib/vcc 删除

这是「最后一次大改」的主体：编译器 0.4.27 已换，这次把引擎也收进本包。

## 结构

| 旧 | 新 |
|---|---|
| `lib/vcc/engine.js` | `lib/engine/base.js`（移植，行为未改） |
| `lib/vcc/region.js` | `lib/engine/region.js` |
| `lib/vcc/preset-check.js` | `lib/engine/preset-check.js` |
| `lib/vcc/shadow-check.js` | `lib/engine/shadow-check.js` |
| `lib/vcc/session-compat.js` | `lib/engine/session-compat.js` |
| 散落各处的 `@deepseek-ai/*` | **只有 `lib/host.js`** |

`lib/vcc/` 整个删除。盒子的门仍是 `lib/engine/api.js`，`CONTRACT.md` 未改。

## 怎么证明行为没变

`tools/shadow-compare.mjs`：拿 **0.4.28 的 tgz** 当基线（不是仓库，vcc 已删），比四样：

| 比什么 | 结果 |
|---|---|
| `resolveConfig` 逐字段 | 一致 |
| 引擎原型方法集合 / 设置命名空间 | 一致 |
| 编译条目（7,307 条）逐字节 | 0 差异 |
| `stats`、投影条目与 stats | 一致 |

全量测试 140/140（新增一条：除 `lib/host.js` 外不许 import 宿主包）。

## 顺带记两个坑

1. `/sdcard` 上用 Node `copyFileSync` 拷 tgz 会得到坏文件（177 KB 拷成 25 MB），tar 报
   `not in gzip format`——影子工具改成先拷到本地盘再解；
2. `args.indexOf('--baseline')` 找不到时是 -1，`-1+1=0` 会把会话文件当基线路径——已加判断。

## 还没验的

- **真实压缩**：等重启后跑，验四档账、取回率、零改写、落点；
- **五场景故障注入**：压力 / 溢出 / 暂缓 / 异常回滚 / 连压，脚本还没写。
