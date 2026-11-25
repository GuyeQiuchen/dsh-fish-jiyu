# 本机的改动（每次换阿记的包都要重新合）

阿记的包是上游，我的改动是在她基础上的本地补丁。**整包装会覆盖这些**，所以每换一次包都要照着这份清单重做一遍，并跑一遍验收。

上游会变，行号会漂，所以这里写的是**改什么、为什么、怎么验**，不是 diff。

**当前基线：0.4.19（2026-11-25）**

---

## 0.4.19 已经吸收了，不再需要本机补丁的

| 项 | 她做在哪 | 说明 |
|---|---|---|
| 近段二分软上限 0.95 → 0.85 | `lib/linear.js` 约 671 行，`nearShare` | 还做成了可配项，比我原来写死的好 |
| 远段优先级 `work * 10 + related` | `lib/linear.js` 约 542 行，内联在 `farItems.push` | 没抽成 `farPriority` 函数，按名字搜是搜不到的 |
| 草稿类型不算未知格式 | `lib/blocks.js` 行 8 + 24，`DRAFT_TYPES` | `reasoning` / `thinking` 静默跳过 |
| 实体拷贝安装 | `install.ps1` | 她的做法更完整：先存 `local-packages`，再实体拷贝，是幂等的 |

---

## 仍然需要本机补丁的：只有一处

### 1. `index.js`：vcc 引擎改成动态 import

**改什么**：`import DefaultEngine from './lib/vcc/engine.js'` 和 `import * as COMPILER from './lib/vcc/compiler.js'`
改成顶层 await 的 `Promise.all([import(...), import(...)])`，包在 `try/catch` 里，catch 中调 `recordLoadError(...)` 再 `throw`。

**为什么**：静态 import 在 `markAlive` 之后、`recordLoadError` 能被调用之前就执行。
只要依赖链断一环（比如 `@deepseek-ai/dsh-compaction` 解析不到），整个模块直接炸，
`recordLoadError` 这个函数**定义了却永远没机会跑**——于是界面上只有「未运行」三个字，
`~/.dsh/fish-jiyu/load-error.txt` 永远是空的。

2026-11-25 我在这上面耗了半天：压缩停了一整天，只知道状态是 `inactive`，不知道原因。

**怎么验**：
```powershell
# 删掉旧的错误文件，重启，看有没有新的
Remove-Item "$HOME\.dsh\fish-jiyu\load-error.txt" -ErrorAction SilentlyContinue
# 重启后
Get-Content "$HOME\.dsh\fish-jiyu\load-error.txt"   # 有内容 = 失败被记下来了
```

**注意**：不能吞掉异常。吞了引擎就静默不激活，比崩溃更难查。

---

### 2. `install.ps1`：纯 ASCII，别再写中文

**改什么**：把脚本里所有中文注释改成英文。

**为什么**：PowerShell 5.1 读**无 BOM 的 UTF-8** 文件时按 ANSI 解码。脚本里有中文又没有 BOM，
中文变成乱码，乱码破坏语法，`install.ps1` 直接解析失败——**一句命令都跑不了**。

0.4.19 的原始 tgz 就是这样：开头注释写着「Keep this file ASCII-only: PowerShell 5.1 reads
BOM-less files as ANSI」，正文却有 3 行中文注释，实测语法错 1 处。

**怎么验**：
```powershell
$p = 'install.ps1'
$raw = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
if ($raw -match '[\u4e00-\u9fa5]') { '有中文 —— 必须加 BOM 或改成英文' } else { '纯 ASCII，安全' }
```

**两条路选一条**：
- 保持纯 ASCII（推荐，不受 BOM 影响，拷来拷去都不会坏）
- 或者写中文，但**必须存成带 BOM 的 UTF-8**

---

## 本机独有的文件（上游没有，换包时要保下来）

| 文件 | 作用 |
|---|---|
| `docs/LOCAL-PATCHES.md` | 就是这份清单 |
| `scripts/verify-local.mjs` | 一次跑完「装上之后到底有没有在工作」，查的是真机状态不是单测 |
| `test/draft-types.test.mjs` | 草稿类型不该被上报的回归测试（上游已修，测试留着防回退） |
| `.gitignore` | 排除 `node_modules`、`*.bak-*`、`loaded.txt`、`load-error.txt`、`index.full.js*` |

---

## 换包流程

1. 备份工作区（含 `.git`）：`D:\蓝色大肥鱼\_backup\jiyu-ws-<旧版本>-<时间戳>`
2. 清空工作区内容，保留 `.git`
3. 把新包内容拷进去
4. 从备份里恢复上面那四个本机独有的文件
5. 照上面「仍然需要本机补丁的」重做
6. `node --check index.js` 和 `node --check lib\linear.js`
7. 跑全部测试：`test` 目录下每个 `.mjs`，`integration-constraints.mjs` 会因作者路径失败，可忽略
8. 跑 `install.ps1` 同步到 profile
9. **重启**，然后看三样：
   - `node_modules\dsh-fish-jiyu\loaded.txt` 时间戳晚于进程启动时间
   - `~\.dsh\fish-jiyu\load-error.txt` 没有新内容
   - `~\.dsh\fish-jiyu\last-report.json` 有新记录
