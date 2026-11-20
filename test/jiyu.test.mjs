/**
 * 离线对照测试：拿真实会话日志跑线性投影，检查三件事。
 *   1. 真的压小了（不能比原样大）；
 *   2. 近段原文还在、中段有事实行、远段有关键词 + 指针；
 *   3. 关键词索引能把远段的旧问题指回原块（取回率）。
 *
 * 用法：node test/linear.test.mjs [session.v4.jsonl.zstd]
 */
import { parseEvents, toNodes } from './session.mjs'
import { assignBlocks, projectRegion, matchIndex, extractKeywords, factLine } from '../lib/linear.js'

const DEFAULT_SESSION =
  ''

const VCC_COMPILER =
  new URL('../lib/vcc/compiler.js', import.meta.url).href

const { estimateEntryTokens } = await import(VCC_COMPILER)

const sessionFile = process.argv[2] ?? DEFAULT_SESSION
if (sessionFile === '') {
  console.log('跳过 ' + import.meta.url.split('/').pop() + '：这不是自动测试，需要传一个会话文件路径')
  process.exit(0)
}
const nodes = toNodes(parseEvents(sessionFile))

/** 模拟 vcc 编译：每条节点一条文本条目。 */
const entries = nodes.map((node) => ({
  seq: node.seq,
  kind: 'text',
  text: `${node.role === 'user' ? '你' : '我'}：${node.text.slice(0, 900)}`,
}))

const estimate = estimateEntryTokens
const sumTokens = (list) => list.reduce((sum, entry) => sum + estimate(entry.text), 0)

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  ${detail}`}`)
}

const blocks = assignBlocks(nodes, { titleChars: 24, maxQuotes: 3 })
const before = sumTokens(entries)
const targetTokens = Math.floor(before * 0.35)
const result = projectRegion({
  entries,
  blocks,
  targetTokens,
  estimate,
  nearBlocks: 3,
  midMax: 140,
  farWords: 6,
})

const after = result.stats.tokens
console.log(`\n会话：${sessionFile.split('\\').at(-2)}`)
console.log(`节点 ${nodes.length} · 块 ${blocks.length} · 条目 ${entries.length}`)
console.log(`token：${before} → ${after}（目标 ${targetTokens}，压到 ${((after / before) * 100).toFixed(1)}%）`)
console.log(`条目：near ${result.stats.near} · mid ${result.stats.mid} · far ${result.stats.far} · 索引词 ${result.stats.indexWords}`)

check('投影后确实变小', after < before)
check('压到目标以内或附近', after <= Math.max(targetTokens * 1.5, before * 0.5), `${after} vs ${targetTokens}`)
check('近段条目保留', result.stats.near > 0)
check('全序递增', result.entries.every((entry, i, arr) => i === 0 || arr[i - 1].seq <= entry.seq))

const nearText = result.entries.slice(-result.stats.near).map((entry) => entry.text).join('\n')
const lastBlock = blocks.at(-1)
check('最后一块的原文在结果里', nearText.includes(lastBlock.quotes[0] ?? ''))

const indexEntry = result.entries.find((entry) => String(entry.text).startsWith('[关键词索引]'))
const indexText = String(indexEntry?.text ?? '')
check('存在全局关键词索引', indexEntry !== undefined)

// 每个话题块都要在结果里留一个落脚点（原文、事实行或关键词行），不能悄悄丢。
const covered = new Set()
for (const entry of result.entries) {
  for (const block of blocks) {
    if (entry.seq >= block.startSeq - 2 && entry.seq <= block.endSeq + 2) covered.add(block.startSeq)
  }
}
const userBlocks = blocks.filter((block) => block.quotes.length > 0)
const uncovered = userBlocks.filter((block) => !covered.has(block.startSeq))
check('每个用户话题块都有落脚点', uncovered.length === 0, `${uncovered.length} 个未覆盖`)

// 取回测试：只看真正进了远段的用户块。
//   主指标：块自己的关键词行里能不能找到问题的词（检索时先看这一行）；
//   副指标：全局索引能不能把词指回这一块。
const farLineBySeq = new Map(
  result.entries
    .filter((entry) => String(entry.text).includes('词：'))
    .map((entry) => [entry.seq, String(entry.text)]),
)
const farUserBlocks = userBlocks.filter((block) => farLineBySeq.has(block.startSeq))
let selfHits = 0
let indexHits = 0
const misses = []
for (const block of farUserBlocks) {
  const question = (block.quotes[0] ?? block.title ?? '').trim()
  if (question.length < 6) continue
  const words = extractKeywords(question, 6)
  const ownLine = farLineBySeq.get(block.startSeq) ?? ''
  const selfHit = words.some((word) => ownLine.includes(word))
  const matched = matchIndex(indexText, question, 4)
  const indexHit = matched.some((item) =>
    item.ranges.some(([start, end]) => block.startSeq >= start - 5 && block.endSeq - 1 <= end + 5),
  )
  if (selfHit) selfHits += 1
  if (indexHit) indexHits += 1
  if (!selfHit) misses.push({ seq: block.startSeq, question: question.slice(0, 40), words, ownLine })
}
const total = farUserBlocks.filter((block) => (block.quotes[0] ?? block.title ?? '').trim().length >= 6).length
console.log(`\n取回测试（远段用户块 ${total} 个）：关键词行命中 ${selfHits}，索引命中 ${indexHits}`)
if (misses.length > 0) console.log('未命中：', misses.slice(0, 5))
check('远段关键词行取回率 ≥ 70%', total === 0 || selfHits / total >= 0.7, `${selfHits}/${total}`)

console.log('\n--- 中段样例 ---')
console.log(
  result.entries
    .filter((entry) => String(entry.text).startsWith('[块') && !String(entry.text).includes('词：'))
    .slice(0, 3)
    .map((entry) => entry.text)
    .join('\n'),
)
console.log('\n--- 远段样例 ---')
console.log(
  result.entries
    .filter((entry) => String(entry.text).includes('词：'))
    .slice(0, 3)
    .map((entry) => entry.text)
    .join('\n'),
)
console.log('\n--- 索引行 ---')
console.log(indexText.slice(0, 500))

// 冻结点：把上一次投影的结果再投一次，同一块的行必须逐字节不变。
// 变了就是前缀缓存作废，早期内容也跟着漂。
const again = projectRegion({ entries: result.entries, blocks, targetTokens, estimate, nearBlocks: 3, midMax: 140, farWords: 6 })
const lineMap = (list) =>
  new Map(
    list
      .filter((entry) => /\[块 seq \d+-\d+/.test(String(entry.text)))
      .map((entry) => [entry.seq, String(entry.text)]),
  )
const firstLines = lineMap(result.entries)
const secondLines = lineMap(again.entries)
let rewritten = 0
for (const [seq, text] of secondLines) {
  const was = firstLines.get(seq)
  if (was !== undefined && was !== text) rewritten += 1
}
check('同一块重投影后逐字节不变', rewritten === 0, `${secondLines.size} 块里 ${rewritten} 块被改写`)

// KEEP 清单：路径、带单位的数值这类碎片要逐字进事实行，不然就得整段翻回来。
const keepLine = factLine({
  startSeq: 1,
  endSeq: 9,
  time: Date.now(),
  title: '修风扇',
  quotes: [],
  tools: [],
  ending: '改完 C:\\app\\fan.cs 里的阈值到 3558 rpm 才好',
})
check('事实行留住路径与数值', keepLine.includes('留「') && keepLine.includes('3558 rpm'), keepLine)

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
