# 0.4.20（2026-11-25）

溯在 Windows 11 / PowerShell 5.1 上装 0.4.19 时撞到两个 bug，这一版修掉，并加两条静态守卫。

## 1. `install.ps1` / `uninstall.ps1` 不是纯 ASCII

PowerShell 5.1 读**无 BOM 的 UTF-8** 时按 ANSI（GBK）解码。文件开头自己写着
「Keep this file ASCII-only」，正文却有三行中文注释——乱码破坏了引号配对，
整个脚本解析失败：

```
+ } else {
表达式或语句中包含意外的标记“}”。
```

报错在第 93 行，真病因在第 87 行，隔得很远。

**改法**：中文注释全部改成英文（而不是加 BOM）。理由和溯一致：BOM 会被编辑器、
git 配置、复制粘贴悄悄剥掉，同一个坑下次还会踩；纯 ASCII 没有这个问题。
`uninstall.ps1` 里同类注释一并改掉。

**守卫**：`test/portability.test.mjs` 断言两个脚本必须纯 ASCII。

## 2. `index.js` 静态 import 导致加载失败时零诊断

`lib/vcc` 原来是静态 import。ES 模块的静态 import 在模块体执行之前求值，
所以依赖链断一环（溯那边是 `@deepseek-ai/dsh-compaction` 解析不到）时：

1. 模块直接抛错；
2. `recordLoadError` 定义了，却**永远轮不到调用**；
3. `load-error.txt` 不存在，插件页只显示「未运行」。

**改法**：改成动态 import + `try/catch`，catch 里先 `recordLoadError` 再 **rethrow**。
那个 throw 不能省——吞掉异常就是静默不激活，比崩溃更难查。

**守卫**：测试里复制一份包、删掉 `lib/vcc/engine.js`、跑一次 import，
断言「抛错」且 `load-error.txt` 里有内容。

## 测试

127/127 通过（新增 3 条：两个 .ps1 的 ASCII 守卫、无静态 import 守卫、失败落盘实测）。
