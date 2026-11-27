# 0.4.23（2026-11-26）

## 只是搬家：引擎封进盒子，输出零改动

### 盒子

```
lib/engine/
  api.js        ← 唯一入口，插件只许 import 这个
  CONTRACT.md   ← 输入输出、常量、变更规则
```

`index.js` 现在只从 `lib/engine/api.js` 进引擎，不再深引用 `linear.js` / `plan.js`。

### 废弃方案移出 lib

| 文件 | 去哪 |
|---|---|
| `allocation.js`（价值求解） | `experiments/` |
| `window.js`（全局索引实验） | `experiments/` |

连同它们的测试一起搬走。`experiments/README.md` 写明「已否决，不要 import」。

### 新增守卫

`test/boundary.test.mjs` 四条：

1. `index.js` 不许 import `linear.js`/`plan.js`；
2. 引擎三个文件不许 import `node:fs`、不许反向依赖插件；
3. `api.js` 必须导出契约里的名字；
4. 插件不许碰 `allocation.js`/`window.js`。

## 等价性证明（重构前后逐字节比对）

同一份 600 条输入、同一预算：

| 路径 | 输出条目 | tokens | keep |
|---|---|---|---|
| `engine: time` | **完全一致** | 57,653 | 53 |
| `engine: plan` | **完全一致** | 54,323 | 48 |

## 验证

- 全量 143/143（少的 20 条是搬去 experiments 的死代码测试）；
- 真实会话验收 ALL PASS：取回率 247/253、598 块重投影零改写、每块都有落脚点。
