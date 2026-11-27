# 0.4.27 — 编译器换成自己的

只动「谁把事件变成条目」，一行投影算法没改。

## 换掉了什么

| 旧 | 新 |
|---|---|
| `lib/vcc/compiler.js` 的 `compileNodes` | `lib/compiler/render.js` |
| `estimateEntryTokens` / `countTokens` / `tokenize` | `lib/compiler/tokens.js` |
| `stripNoiseXml` + 噪声正则 | `lib/compiler/noise.js` |
| 检查点识别、注入内容折叠 | `lib/compiler/checkpoint.js` |

引擎（触发、事务、保留区、surface 协议）**仍然是 `lib/vcc/engine.js`**，没动。

## 怎么证明没改行为

`tools/compiler-golden.mjs`：把旧编译器的输出冻成 golden（7,057 条），新实现逐字节对照。

```bash
node tools/compiler-golden.mjs write <会话> <out.json> --impl=vcc
node tools/compiler-golden.mjs check <会话> <golden.json> --impl=new
```

| 验收 | 结果 |
|---|---|
| 整段条目（7,057 条）逐字节 | 0 条不一致 |
| stats（工具调用、结果、噪声、折叠…） | 全部相等 |
| cap 路径（393k / 120k / 40k / 8k） | 条目、拼接、capped 全一致 |

`test/compiler.test.mjs` 另加 4 条行为锁，不依赖真实会话。

## 加载失败的处理

引擎和编译器现在**分两条 try**：坏哪条就记哪条（`加载 lib/vcc（引擎）失败` / `加载 lib/compiler（编译器）失败`），
都不会再出现「外壳加载了、引擎静默不激活」。

## 没做的

- token 估算仍与旧实现同值（换算法是下一步）；
- `lib/vcc/compiler.js` 还没删：等引擎也换完、确认零引用再删，许可声明跟着留到最后。
