/**
 * 远段逐条装 + 近段上限（0.4.16）。
 *
 * 为什么要有：以前「远段整份装不下就整段丢」，超 20 字符和超 2 万一样归零。
 * 实测那次 target 68,812、压完 64,504，箱子还空 4.3k，远段 15 条只要约 1.4k。
 * 现在按剩余空间逐条装，并有 target × farShare 的硬上限。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectRegion, DEFAULT_FAR_SHARE, keywordLine, blockKeywords, MIN_FAR_LINE } from '../lib/linear.js'

const estimate = (text) => String(text ?? '').length

/** 互不重复的关键词，保证远块不会因为和近段沾边被提档。 */
const POOL = '稻田 麦穗 谷仓 犁铧 春雨 溪流 松林 木船 渔网 铁锤 窑炉 陶罐 石桥 路灯 窗棂 门环 井台 磨坊 风车 盐场'.split(' ')

/**
 * 造一份会话：每组块一条长正文（保证近段会把预算吃满），
 * 前 farCount 块话题互不相干（落在关键词档），最后 3 块是近段。
 */
function makeSession(farCount) {
  const blocks = []
  const entries = []
  let seq = 100
  for (let i = 0; i < farCount; i += 1) {
    blocks.push({ startSeq: seq, endSeq: seq + 40, title: `${POOL[i % POOL.length]}${i}`, quotes: [], ending: '', tools: [], time: null })
    entries.push({ seq, text: 'x'.repeat(300), kind: 'text' })
    seq += 40
  }
  for (let i = 0; i < 3; i += 1) {
    blocks.push({ startSeq: seq, endSeq: seq + 40, title: `近段${POOL[POOL.length - 1 - i]}`, quotes: ['当前进行中的收尾工作'], ending: '', tools: [], time: null })
    entries.push({ seq, text: 'n'.repeat(300), kind: 'text' })
    seq += 40
  }
  return { blocks, entries }
}

const keywordChars = (out) =>
  out.entries.filter((entry) => String(entry.text).includes('词：')).reduce((sum, entry) => sum + estimate(entry.text), 0)

test('远段不再整段丢：预算紧时仍装进一部分', () => {
  const { blocks, entries } = makeSession(20)
  const out = projectRegion({ entries, blocks, targetTokens: 1400, estimate })
  assert.ok(out.stats.far >= 1, `远段不该归零，实际 ${out.stats.far}`)
  assert.ok(out.stats.far < 20, `预算紧时不该全装，实际 ${out.stats.far}`)
})

test('远段有硬上限：最多吃 target × farShare', () => {
  const target = 1400
  const { blocks, entries } = makeSession(20)
  const out = projectRegion({ entries, blocks, targetTokens: target, estimate })
  const used = keywordChars(out)
  assert.ok(used > 0, '这一档应该有远段')
  assert.ok(used <= Math.floor(target * DEFAULT_FAR_SHARE) + 40, `远段用了 ${used} 字符，超过上限`)
})

test('预算极小：远段跳过，但每个块仍留指针', () => {
  const { blocks, entries } = makeSession(6)
  const out = projectRegion({ entries, blocks, targetTokens: 300, estimate })
  assert.equal(out.stats.far, 0, '空间不够时不该硬塞远段')
  for (const block of blocks) {
    assert.ok(
      out.entries.some((entry) => Number(entry.seq) >= block.startSeq && Number(entry.seq) <= block.endSeq),
      `块 ${block.startSeq} 连指针都没有`,
    )
  }
})

test('报告口径：stats.far 等于真发出去的关键词行数', () => {
  const { blocks, entries } = makeSession(20)
  for (const target of [1400, 2500, 4000]) {
    const out = projectRegion({ entries, blocks, targetTokens: target, estimate })
    const lines = out.entries.filter((entry) => String(entry.text).includes('词：')).length
    assert.equal(out.stats.far, lines, `target ${target}: 报告 ${out.stats.far}，实际 ${lines}`)
  }
})

test('nearShare 可配：比例越小，保留的原文越少', () => {
  const { blocks, entries } = makeSession(20)
  const loose = projectRegion({ entries, blocks, targetTokens: 6000, estimate, nearShare: 0.95 })
  const strict = projectRegion({ entries, blocks, targetTokens: 6000, estimate, nearShare: 0.5 })
  assert.ok(strict.stats.keep <= loose.stats.keep, `strict keep ${strict.stats.keep} > loose ${loose.stats.keep}`)
  assert.ok(strict.stats.tokens <= loose.stats.tokens)
})

test('MIN_FAR_LINE 与真实行宽对得上（否则逐条装永远装不进）', () => {
  const block = { startSeq: 100, endSeq: 140, title: '搭环境', quotes: ['部署脚本'], ending: '跑通了', tools: [] }
  const width = keywordLine(block, blockKeywords(block, 6)).length
  assert.ok(width > MIN_FAR_LINE, `关键词行 ${width} 字符，不该小于门槛 ${MIN_FAR_LINE}`)
})

// —— 单行成本封顶（0.4.21）：把中段/远段每行裁短，省下来的预算还给近段原话
test('行成本封顶：同预算下原文块变多，且不超目标', () => {
  const { blocks, entries } = makeSession(40)
  const target = 4000
  const plain = projectRegion({ entries, blocks, targetTokens: target, estimate })
  const capped = projectRegion({ entries, blocks, targetTokens: target, estimate, factCap: 60, keywordCap: 24 })
  assert.ok(capped.stats.near >= plain.stats.near, `封顶后原文块 ${capped.stats.near} 少于不封顶 ${plain.stats.near}`)
  assert.ok(capped.stats.tokens <= target, `超预算：${capped.stats.tokens}`)
})

test('行成本封顶：冻结行不被重裁（否则前缀会漂）', () => {
  const { blocks, entries } = makeSession(12)
  const first = projectRegion({ entries, blocks, targetTokens: 3000, estimate, factCap: 60, keywordCap: 24 })
  // 把上一次的行原样喂回去，模拟下一次投影
  const again = projectRegion({ entries: first.entries, blocks, targetTokens: 3000, estimate, factCap: 20, keywordCap: 10 })
  const frozenBefore = first.entries.filter((entry) => String(entry.text).includes('[块 seq'))
  const frozenAfter = again.entries.filter((entry) => String(entry.text).includes('[块 seq'))
  const overlap = frozenBefore.filter((entry) => frozenAfter.some((other) => other.seq === entry.seq && other.text === entry.text))
  assert.ok(overlap.length > 0, '已进过窗口的行应逐字节沿用')
})
