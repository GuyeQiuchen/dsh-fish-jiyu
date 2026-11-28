# 引擎契约（dsh-fish-jiyu）

**内部实现随便重写，输出形状不许变。** 这是这个盒子唯一的承诺。

## 入口

只有 `lib/engine/api.js`。插件 `index.js` 里出现任何 `from './lib/linear.js'`、`from './lib/plan.js'` 都算违规（有测试扫）。

## 对外导出

### `projectRegion(input)`

输入：

| 字段 | 类型 | 说明 |
|---|---|---|
| `entries` | `{ seq, kind?, text }[]` | 待投影条目，seq 升序 |
| `blocks` | `{ startSeq, endSeq, title?, tools? }[]` | 块，endSeq 为开区间 |
| `targetTokens` | number | 预算；0 = 不压缩 |
| `estimate` | `(text) => number` | token 估算 |
| `factCap` / `keywordCap` | number | 单行上限，0 = 不裁 |
| `farShare` | number | 远段预算上限（仍生效） |
| `nearShare` / `engine` | — | **已弃用**：接受但不生效，只提示一次 |

输出：

```
{ entries: { seq, text }[], stats: { tokens, near, mid, far, keep, blocks, indexWords, tiers } }
```

`stats.near` 是**条目数**，`stats.keep` 才是**块数**——这两个数别再混。

### `planProjection(input)`

输入：`{ blocks, costOf(index, tier), target, indexCost?, headroom?, factShare? }`
输出：`{ tiers, k, m, tokens, counts }`

### 常量

`DEFAULT_FAR_SHARE=0.15`、`DEFAULT_FACT_CAP=60`、`DEFAULT_KEYWORD_CAP=24`、`DEFAULT_HEADROOM=0.05`、`DEFAULT_FACT_SHARE=0.2`。改数值算契约变更。

## 不属于引擎的

- 文件读写、报告落盘、配置解析、约束区渲染、工具注册——都在插件层。
- 会话日志解析（`test/session.mjs` 那套）也不在这里。
