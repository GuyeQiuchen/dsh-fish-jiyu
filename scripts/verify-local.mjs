/**
 * 本机验收：一次跑完「装上之后到底有没有在工作」。
 *
 * 为什么单独写一个：今晚反复栽在同一件事上 —— 文件改对了、测试过了，
 * 就宣布"生效了"，然后发现进程里跑的还是旧代码；或者报告字段出来了，
 * 却没看它是不是 null。这些都不是单测能抓的，只能对着真机状态看。
 *
 * 用法：
 *   <宿主 node> scripts/verify-local.mjs
 *
 * 只看事实，给出口径，不做判断。哪一项该怎样判，写在每项的 hint 里。
 *
 * 两个包都要看：鲫鱼管压缩与约束区，记忆体管 boot 与 seq 取回，
 * 本机补丁分别落在两边 —— 混着查会得出"补丁不在"的假报告（第一版就这么错的）。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
// 本文件在 <workspace>/dsh-fish-jiyu/scripts/，所以往上是两级才是放两个包的目录
const WS = path.dirname(path.dirname(import.meta.dirname))
const PROFILE = path.join(HOME, 'profiles', 'desktop', 'node_modules')
const PACKS = [
  { key: 'jiyu', dir: 'dsh-fish-jiyu', label: '鲫鱼' },
  { key: 'memory', dir: 'dsh-fish-memory', label: '记忆体' },
]

const rows = []
function item(name, value, hint) {
  rows.push({ name, value: String(value), hint: hint ?? '' })
}
function safe(fn, fallback = '(读不到)') {
  try {
    return fn()
  } catch (error) {
    return `${fallback}: ${error?.message ?? error}`
  }
}
function read(dir, file) {
  const p = path.join(dir, file)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
function pkgVersion(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version
}

// ── 一、两个包各自：版本、两侧一致、加载时间 ────────────────────
for (const pack of PACKS) {
  const wsDir = path.join(WS, pack.dir)
  const liveDir = path.join(PROFILE, pack.dir)
  const tag = pack.label
  item(`${tag}·版本`, `${safe(() => pkgVersion(wsDir))} / ${safe(() => pkgVersion(liveDir))}`, '工作区 / 运行目录')
  item(
    `${tag}·index.js 两侧一致`,
    safe(() => (Buffer.compare(readFileSync(path.join(wsDir, 'index.js')), readFileSync(path.join(liveDir, 'index.js'))) === 0 ? '是' : '否')),
    '否 = 改了工作区但没同步',
  )
  item(
    `${tag}·插件记的加载时间`,
    safe(() => {
      const t = read(liveDir, 'loaded.txt').trim()
      return t === '' ? '没有 loaded.txt' : t
    }),
  )
  item(`${tag}·index.js 最后修改`, safe(() => statSync(path.join(liveDir, 'index.js')).mtime.toISOString()), '加载时间早于这个 = 进程里还是旧代码，要重启')
}

// ── 二、本机补丁还在不在（整包装会覆盖）────────────────────────
// 每一条都标清落在哪个包。换上游包时必须重做，见 docs/LOCAL-PATCHES.md。
const patches = [
  ['鲫鱼', 'dsh-fish-jiyu', ['index.js'], 'carried-only', 'constraints 带 verdict'],
  ['鲫鱼', 'dsh-fish-jiyu', ['docs/LOCAL-PATCHES.md'], '重做', '本机改动清单在'],
  ['记忆体', 'dsh-fish-memory', ['lib/seqread.js'], 'zstdFrames', '多帧逐帧解压'],
  ['记忆体', 'dsh-fish-memory', ['lib/seqread.js'], '本条另有', '超长首条截断并注明'],
  ['记忆体', 'dsh-fish-memory', ['lib/seqread.js'], 'mtime', '无 session 时按 mtime 取最新'],
  ['记忆体', 'dsh-fish-memory', ['lib/seqread.js'], 'tail', '末帧半截的 warning'],
  ['记忆体', 'dsh-fish-memory', ['index.js'], '长成自己想要的样子', '人格收成一句'],
]
for (const [packLabel, dirName, files, marker, label] of patches) {
  const wsDir = path.join(WS, dirName)
  const liveDir = path.join(PROFILE, dirName)
  const inWs = files.some((f) => read(wsDir, f).includes(marker))
  const inLive = files.some((f) => read(liveDir, f).includes(marker))
  const state = inWs && inLive ? '在' : inWs ? '只在工作区' : inLive ? '只在运行目录' : '不在'
  item(
    `补丁·${label}`,
    `${state}（${packLabel}）`,
    state === '在' ? '' : '这次换包把它冲掉了，照 docs/LOCAL-PATCHES.md 重做',
  )
}

// ── 三、最近一次真实压缩的报告 ──────────────────────────────────
const reportFile = path.join(HOME, 'fish-jiyu', 'last-report.json')
item('压缩报告时间', safe(() => (existsSync(reportFile) ? statSync(reportFile).mtime.toISOString() : '还没有报告')))
const latest = safe(() => {
  const raw = JSON.parse(readFileSync(reportFile, 'utf8'))
  const list = Array.isArray(raw) ? raw : [raw]
  return list.sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1)
}, null)
if (latest && typeof latest === 'object') {
  item('报告覆盖区间', `${latest.seqFrom} - ${latest.seqTo}`)
  item('报告里的 sessionEvents', latest.sessionEvents ?? '(无)', '过 6 万会在检查点顶部顶一行提醒')
  const c = latest.constraints
  if (c === null || c === undefined) {
    item('constraints', 'null', '0.4.12 及以后不该再是 null —— 说明跑的是旧代码')
  } else {
    const n = Array.isArray(c.rows) ? c.rows.length : c.rows
    item('constraints.rows', n ?? '(无)')
    item('constraints.carried', c.carried ?? '(无)')
    item('constraints.fresh', c.fresh ?? '(无)')
    item('constraints.verdict', c.verdict ?? '(无)', '没有 verdict = 本机补丁没生效；有 = 能分清「压丢」和「本来没有」')
  }
  const bt = latest.blockTypes
  item(
    'blockTypes',
    bt === undefined ? '(无此字段)' : JSON.stringify(bt),
    '空对象 {} = 全是认识的类型；有内容 = 宿主新出了块类型，那些内容没进上下文',
  )
}

// ── 四、守卫账本 ────────────────────────────────────────────────
const guardLog = path.join(HOME, 'attention-health', 'guard-trips.jsonl')
item(
  '守卫账本',
  safe(() => (existsSync(guardLog) ? `${readFileSync(guardLog, 'utf8').trim().split('\n').filter(Boolean).length} 条` : '不存在')),
  '不存在 = 从没触发过（可能因为没打转，也可能因为没加载）',
)

// ── 五、测试文件在不在（不跑，只数）────────────────────────────
for (const pack of PACKS) {
  item(
    `${pack.label}·测试文件`,
    safe(() => `${readdirSync(path.join(WS, pack.dir, 'test')).filter((f) => f.endsWith('.mjs')).length} 个 .mjs`),
    '拿宿主 node 跑，每个都得 exit 0；integration-* 要传本机会话日志路径',
  )
}

// ── 输出 ────────────────────────────────────────────────────────
const width = Math.max(...rows.map((r) => r.name.length))
for (const r of rows) {
  console.log(`${r.name.padEnd(width)} : ${r.value}`)
  if (r.hint) console.log(`${' '.repeat(width)}   ↳ ${r.hint}`)
}
