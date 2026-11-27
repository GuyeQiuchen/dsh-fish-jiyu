/**
 * 垫底指针的定价与预算（2026-11-27 审查 B1/B2/B5/B6 的回归）。
 *
 * 事故一：plan 把「每块垫底的一行指针」按关键词行计价（37 vs 13 token），
 *   块一多就判定「连垫底都装不下」，k=0，一条原文都不留。
 * 事故二：每块落脚点在裁剪之后无条件补，补多少不复核，压完超目标 10.9%。
 * 事故三：只剩指针的块被算进 stats.keep；索引词数报的是全量而不是印出来的。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectRegion, assignBlocks, INDEX_LIMIT } from '../lib/linear.js'
import { estimateEntryTokens as estimate } from '../lib/compiler/tokens.js'

/** 造 N 块：每块一条用户一条助手，正文够长但不夸张。 */
function session(count) {
  const nodes = []
  let seq = 1
  for (let i = 0; i < count; i += 1) {
    nodes.push({ seq: seq++, role: 'user', text: `第${i}件事：` + '讨论'.repeat(40) })
    nodes.push({ seq: seq++, role: 'assistant', text: '回复：' + '结论'.repeat(40) })
  }
  const blocks = assignBlocks(nodes)
  const entries = []
  for (const block of blocks) {
    for (let s = block.startSeq; s < block.endSeq; s += 1) entries.push({ seq: s, text: `seq ${s} 的正文 ` + '内容'.repeat(30), kind: 'text' })
  }
  return { blocks, entries }
}

const isRaw = (entry) => !/^\[块 seq/.test(String(entry.text)) && !String(entry.text).startsWith('[关键词索引]')
const project = (engine, targetTokens) => {
  const { blocks, entries } = session(800)
  const result = projectRegion({
    entries, blocks, targetTokens, estimate, nearBlocks: 3, midMax: 140, farWords: 6,
    engine, nearShare: 0.85, farShare: 0.15, factCap: 60, keywordCap: 24,
  })
  return { result, blocks }
}

test('plan 在「垫底按关键词价就超预算」的规模下仍留下原文', () => {
  // 800 块 × 37 ≈ 29.6k > 目标 20k×0.95：旧代码在这里 k=0。
  const { result } = project('plan', 20000)
  const raw = result.entries.filter(isRaw)
  assert.ok(raw.length > 0, 'plan 一条原文都没留')
})

test('两个引擎压完都不超目标（指针也算进预算）', () => {
  for (const engine of ['time', 'plan']) {
    const { result } = project(engine, 20000)
    assert.ok(result.stats.tokens <= 20000, `${engine} 压完 ${result.stats.tokens} > 20000`)
  }
})

test('每块都有落脚点），哪怕只留一行指针', () => {
  const { result, blocks } = project('plan', 20000)
  const covered = new Set()
  for (const entry of result.entries) {
    for (const block of blocks) {
      const seq = Number(entry.seq)
      if (seq >= block.startSeq && seq < block.endSeq) covered.add(block.startSeq)
    }
  }
  assert.equal(covered.size, blocks.length)
})

test('keep 只数真留下原文的块，不把指针算进去', () => {
  // 预算小到只能发指针：旧代码把「有行落在区间里」都算保住，keep 会报满。
  const blocks = []
  const entries = []
  let seq = 1
  for (let i = 0; i < 5; i += 1) {
    blocks.push({ startSeq: seq, endSeq: seq + 2, title: `块${i}`, quotes: [], ending: '', tools: [], time: null })
    entries.push({ seq, text: 'x'.repeat(400), kind: 'text' })
    entries.push({ seq: seq + 1, text: 'y'.repeat(400), kind: 'text' })
    seq += 2
  }
  const result = projectRegion({ entries, blocks, targetTokens: 20, estimate, nearBlocks: 3, midMax: 140, farWords: 6 })
  assert.ok(result.entries.some((entry) => /原文按 seq 取回/.test(String(entry.text))), '这个预算下应该只剩指针')
  assert.equal(result.stats.keep, 0, `keep 应为 0（没有原文留下），实际 ${result.stats.keep}`)
  assert.equal(result.stats.keepRequested > 0, true)
})

test('indexWords 报的是印出来的词数，不是索引表大小', () => {
  const { result } = project('plan', 20000)
  const line = result.entries.find((entry) => String(entry.text).startsWith('[关键词索引]'))
  if (line === undefined) return
  const printed = String(line.text).replace('[关键词索引]', '').split(';').filter((part) => part.trim() !== '').length
  assert.equal(result.stats.indexWords, Math.min(printed, INDEX_LIMIT))
})
