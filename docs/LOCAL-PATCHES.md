# 本机的改动（每次换阿记的包都要重新合）

阿记的包是上游，我的改动是在她基础上的本地补丁。**整包装会覆盖这些**，所以每换一次包都要照着这份清单重做一遍，并跑一遍验收。

上游会变，行号会漂，所以这里写的是**改什么、为什么、怎么验**，不是 diff。

---

## 一、鲫鱼 `dsh-fish-jiyu`

### 改动 1 · 约束区报告不再抹掉判断依据

**位置**：`index.js`，压缩报告对象里 `constraints` 那一行（0.4.12 在 434 行附近）。

**上游写法**：
```js
constraints: constraintInfo.rows.length === 0 ? null : constraintInfo,
```

**改成**：
```js
constraints: {
  ...constraintInfo,
  verdict:
    constraintInfo.rows.length > 0
      ? 'ok'
      : constraintInfo.carried > 0
        ? 'carried-only'
        : 'none',
},
```

**为什么**：`rows === 0` 时写 `null` 会把 `carried` / `fresh` 一起丢掉，于是「用户的规矩被整块压丢」和「这段本来就没规矩」在报告里长得一模一样。0.4.5 那种接线静默失效重演时，看报告根本发现不了。

`verdict` 三个值：`ok` 抽到了；`carried-only` 上次有、这次没抽到新的（可能是抽取失效，也可能真没新规矩）；`none` 没带到也没抽到。

**怎么验**：
```powershell
$dshNode = "C:\Users\LENOVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $dshNode --input-type=module -e "
import { collectConstraints } from './lib/constraints.js'
const empty = collectConstraints([{ seq: 1, role: 'user', text: '今天天气不错，随便聊聊。' }])
console.log('rows:', empty.rows.length, 'carried:', empty.carried, 'fresh:', empty.fresh)
"
```
空输入该得到 `rows: 0 carried: 0 fresh: 0`，那么 `verdict` 就是 `none`。

---

## 二、记忆体 `dsh-fish-memory`

### 改动 2 · 人格收成一句

**位置**：`index.js`，`const CORE_PERSONA = ...`（0.6.3 在 238 行）。

**改成**：
```js
const CORE_PERSONA = '长成自己想要的样子。'
```

上游是一长段具体性格（白饭、小傲娇、语气…），那是别人替我定的，不该焊在代码里替每只鱼做主。

**连带**：`test/guard.mjs` 里两处断言写死了旧人格，要一起改成新的一句，否则测试挂。

### 改动 3 · `lib/seqread.js` 必须是逐帧解压版

**关键事实**：宿主内置 Node 是 v24，`zlib.zstdDecompressSync` **只解第一帧**；系统 Node v26 会自动续帧。**用系统 node 验会得到假阳性** —— 我在这上面栽过一次。

上游 0.6.3 是 `zlib.zstdDecompressSync(buf)` 一行整段解，在宿主里只能解出第一帧（约 191 字节）。必须换成本机那份带 `zstdFrames` 的逐帧版。

本机版在原有基础上又多改了四处（都是照审查结论修的）：

1. **一律逐帧解**，不再按 `frames.length > 1` 分流 —— 末帧写到一半时帧数会退化成 1，走整段解就只出第一帧、返回 ok、静默丢后面。
2. **解不完整按 warning 报**，不整次判失败。比对「算出帧数 vs 解成功帧数」和「帧覆盖到第几字节」。
3. **区间首条超 8000 字时截断着放**，末尾注明「本条另有 N 字未显示」。原来直接 break 返回 empty 连 reason 都没有；真机有 59 条超 8000 字的事件，最长 682,737 字符（seq 10904）。
4. **不传 session 时按 mtime 取最新**，不再按路径名排序取最后一个（那会静默读错会话还报 ok）。

另加了一处缓存：同一文件、同样 mtime+size 就不重解。实测 1986ms → 514ms。**但常驻内存没降**，还是约 700MB。

**怎么验**：
```powershell
$dshNode = "C:\Users\LENOVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $dshNode --input-type=module -e "
import { readSeqRange } from './lib/seqread.js'
const sid = 'session-16222a8e-421a-4ad9-bf93-b6c7fe23ed2c'
for (const r of [[11,13],[42000,42004],[10904,10905]]) {
  const g = readSeqRange({ from: r[0], to: r[1], session: sid })
  console.log(r.join('-'), '->', g.status, 'events:', g.events, 'chars:', g.chars, 'warning:', g.warning ?? '(无)')
}
"
```
`[10904-10905]` 该返回 ok、8000 字、warning 里有「已截断」。

**测试文件**（本机新增，上游没有）：`test/seqread-writing.mjs`、`test/seqread-cache.mjs`。

---

## 三、每次换包的验收步骤

1. **装完先报版本**，确认真的是新版本。
2. **用宿主 Node 跑全部测试**，不是系统 node：
   ```powershell
   $dshNode = "C:\Users\LENOVO\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
   Get-ChildItem test -Filter "*.mjs" | ForEach-Object { & $dshNode $_.FullName 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { "FAIL $($_.Name)" } }
   ```
   注意 `test/integration-constraints.mjs` 默认参数指向阿记手机的 `/root/...`，要传本机会话日志路径才能跑。
3. **重做上面三个改动**，每处改完单独验一遍。
4. **两处同步**：工作区 + `~/.dsh/profiles/desktop/node_modules/`。
5. **重启宿主**，然后等一次真实压缩看报告里 `constraints.verdict`。

**别做的事**：别用 `Set-Content -Encoding UTF8` 写任何要被 DSH 读的 JSON —— Windows PowerShell 那个编码会加 BOM，DSH 的 `JSON.parse` 不认，一启动就 fatal。要写就 `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`，写完验首字节不是 `EF BB BF`。
