/**
 * 2026-11-27 审查修复的回归：截断上限、代理对、分页不重复、窗口标签。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { truncateWords, estimateEntryTokens } from '../lib/compiler/tokens.js'
import { short } from '../lib/linear.js'
import { readRange, shadowedSet } from '../lib/recall.js'

test('truncateWords 不会超过给定上限（含标记）', () => {
  const text = '[tool]\n' + Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\n')
  for (const limit of [0, 1, 2, 5, 10, 20]) {
    const { text: out } = truncateWords(text, limit, 'seq 6')
    assert.ok(estimateEntryTokens(out) <= limit, `limit=${limit} 实际 ${estimateEntryTokens(out)}：${JSON.stringify(out.slice(0, 30))}`)
  }
})

test('short 按码点切，不切出半个 emoji', () => {
  const out = short('a😀bcdef', 3)
  const points = [...out]
  assert.equal(points.some((ch) => { const c = ch.codePointAt(0); return c >= 0xd800 && c <= 0xdfff }), false)
})

test('从行中间开始翻页：不重复交付同一条', () => {
  const events = [1, 2, 3].map((seq) => ({ seq, data: { message: { role: 'user', content: [{ type: 'text', text: `第 ${seq} 条 ` + 'x'.repeat(40) }] } } }))
  const collected = []
  let offset = 0
  for (let page = 0; page < 20; page += 1) {
    const out = readRange(events, 1, 3, offset, 60)
    for (const line of out.text.split('\n')) {
      const m = /^\[seq (\d+)\]/.exec(line)
      if (m !== null) collected.push(Number(m[1]))
    }
    if (out.nextOffset === null) break
    offset = out.nextOffset
  }
  // 第一页正常翻完：三条各出现一次
  assert.deepEqual([...new Set(collected)].sort(), [1, 2, 3])
  assert.equal(collected.length, new Set(collected).size, `有重复：${JSON.stringify(collected)}`)
})

test('分页从行中间开始时，不会把整行再发一遍', () => {
  const events = [1, 2].map((seq) => ({ seq, data: { message: { role: 'user', content: [{ type: 'text', text: `第 ${seq} 条 ` + 'y'.repeat(60) }] } } }))
  const first = readRange(events, 1, 2, 0, 40)
  const offsetInLine = (first.nextOffset ?? 0) + 5
  const next = readRange(events, 1, 2, offsetInLine, 200)
  const seqs = [...next.text.matchAll(/^\[seq (\d+)\]/gm)].map((m) => Number(m[1]))
  assert.equal(seqs.includes(1), false, '行中间的页不该把 seq 1 整行再发一遍')
})

test('报告缺 blocks 时，用 shadowed 区间兜底判「已折叠」', () => {
  assert.equal(shadowedSet({ blocks: [], shadowed: { start: 10, end: 12 } }).has(11), true)
  assert.equal(shadowedSet({ blocks: [], shadowed: null }).has(11), false)
})
