/**
 * 量一下新的「按行核对」在真实会话上的表现：
 *   - 通过 / 报丢 各多少条；
 *   - 报丢的里面，多少条是「关键词行确实没有主题词」（真该报）；
 *   - 对比旧判据（整句切片）报了多少假丢。
 * 用法：node test/lang-check.mjs [session日志]
 */
import { parseEvents, toNodes } from './session.mjs'
import { assignBlocks, projectRegion, extractKeywords } from '../lib/linear.js'

const DEFAULT_SESSION =
  ''
const VCC_COMPILER =
  new URL('../lib/compiler/tokens.js', import.meta.url).href
const { estimateEntryTokens } = await import(VCC_COMPILER)

const sessionFile = process.argv[2] ?? DEFAULT_SESSION
if (sessionFile === '') {
  console.log('跳过 ' + import.meta.url.split('/').pop() + '：这不是自动测试，需要传一个会话文件路径')
  process.exit(0)
}
const nodes = toNodes(parseEvents(sessionFile))
const entries = nodes.map((node) => ({
  seq: node.seq,
  kind: 'text',
  text: `${node.role === 'user' ? '你' : '我'}：${node.text.slice(0, 900)}`,
}))
const blocks = assignBlocks(nodes)
const before = entries.reduce((sum, e) => sum + estimateEntryTokens(e.text), 0)
const result = projectRegion({
  entries,
  blocks,
  targetTokens: Math.floor(before * 0.35),
  estimate: estimateEntryTokens,
  nearBlocks: 3,
  midMax: 140,
  farWords: 6,
})
const summary = result.entries.map((e) => e.text).join('\n')

const CONSTRAINT = /(不要|不许|不准|禁止|别|必须|记得|记住|以后|一律|只能|不可以)/
const constraints = []
for (const node of nodes) {
  if (node.role !== 'user') continue
  for (const line of node.text.split(/\r?\n/)) {
    const text = line.trim()
    if (text.length < 6 || text.length > 140) continue
    if (!CONSTRAINT.test(text)) continue
    constraints.push({ seq: node.seq, text })
  }
}

const SEQ_LINE_RE = /seq\s+(\d+)(?:\s*-\s*(\d+))?/g
const KEY_STOP = new Set(
  '的了我你他她它这那就都还要在有和与把被让给对从到于是但而所以因为如果吗呢吧啊哦嗯很太再又已更最不没会能可么什怎为以于将并且则其之也着过起来去得地是个些真挺好嘛呀'.split(''),
)
function keywordTerms(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/0x[0-9a-f]{2,6}/gi)) out.add(m[0].toLowerCase())
  for (const m of String(text).matchAll(/[A-Za-z][A-Za-z0-9_.\-]{2,}/g)) out.add(m[0].toLowerCase())
  for (const run of String(text).match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const g = run.slice(i, i + 2)
      if (KEY_STOP.has(g[0]) || KEY_STOP.has(g[1])) continue
      out.add(g)
    }
  }
  return [...out]
}
function coveringLine(seq) {
  let best = ''
  let span = Infinity
  for (const line of summary.split(/\r?\n/)) {
    if (!line.includes('seq')) continue
    for (const m of line.matchAll(SEQ_LINE_RE)) {
      const start = Number(m[1])
      const end = m[2] === undefined ? start : Number(m[2])
      if (seq < start || seq > end) continue
      if (end - start < span) {
        span = end - start
        best = line
      }
    }
  }
  return best
}
function termsOf(text) {
  return String(text).split(/[，。；、：？！～,.;:!?…\s（）()「」『』《》"'’‘“”]+/).map((t) => t.trim()).filter((t) => t.length >= 4)
}

const rows = constraints.map((c) => {
  const line = coveringLine(c.seq)
  const terms = termsOf(c.text)
  const words = keywordTerms(c.text)
  const oldCovered = terms.length
    ? terms.filter((t) => summary.includes(t)).length / terms.length
    : summary.includes(c.text) ? 1 : 0
  const newCovered = line === ''
    ? oldCovered
    : words.length === 0
      ? (line.includes(c.text) ? 1 : 0)
      : words.filter((w) => line.includes(w)).length / words.length
  return { ...c, line, words, oldCovered, newCovered }
})

const oldLost = rows.filter((r) => r.oldCovered < 0.6)
const newLost = rows.filter((r) => (r.line === '' ? r.oldCovered < 0.6 : r.newCovered < 0.5))
// 「真该报」的粗略判据：覆盖行存在，且关键词覆盖率 < 0.2（主题词几乎都不在那行）。
const justified = newLost.filter((r) => r.line !== '' && r.newCovered < 0.2).length

console.log(`会话：${sessionFile.split('\\').at(-2)}`)
console.log(`约束 ${rows.length} 条；旧判据报丢 ${oldLost.length} 条；新判据报丢 ${newLost.length} 条`)
console.log(`新判据报丢里，关键词覆盖率 < 0.2（真该报）的有 ${justified} 条`)
console.log('\n新判据报丢样例：')
for (const r of newLost.slice(0, 6)) {
  console.log(`- seq ${r.seq} 覆盖=${r.newCovered.toFixed(2)} | ${r.text.slice(0, 40)} | 行：${r.line.slice(0, 80)}`)
}
