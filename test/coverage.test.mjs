/**
 * 落脚点不变量：每个块都必须在输出里留一行（原文 / 事实 / 关键词 / 指针）。
 *
 * 2026-11-27 抓到的破法：覆盖判定用闭区间、分桶用开区间，于是「下一块首条
 * seq = 本块 endSeq」时，本块被误判已覆盖，整块消失且不补指针。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectRegion } from '../lib/linear.js'
import { estimateEntryTokens as estimate } from '../lib/compiler/tokens.js'

function run(target) {
  const entries = []
  for (let seq = 40; seq < 56; seq += 1) entries.push({ seq, kind: 'text', text: 'x'.repeat(200) + ' seq' + seq })
  const blocks = [{ startSeq: 40, endSeq: 48 }, { startSeq: 48, endSeq: 56 }]
  return projectRegion({ entries, blocks, targetTokens: target, estimate, nearBlocks: 1, midMax: 140, farWords: 6 })
}

test('预算把前一块整个裁掉时，它必须留下指针（不能靠下一块的首条蒙混过去）', () => {
  // 这个 target 下，40-47 整块被裁、48-55 整块保留——正是 off-by-one 的触发条件。
  const result = run(500)
  const landed = result.entries.filter((entry) => entry.seq >= 40 && entry.seq < 48)
  assert.ok(landed.length > 0, '块 40-47 一行都没留下')
  assert.ok(
    result.entries.some((entry) => /seq 40-47/.test(String(entry.text))),
    '块 40-47 应该有一条「原文按 seq 取回」的指针',
  )
})

test('每个块在任何预算下都有落脚点', () => {
  for (const target of [2000, 800, 600, 500, 400, 350, 300, 200, 100]) {
    const result = run(target)
    for (const block of [{ startSeq: 40, endSeq: 48 }, { startSeq: 48, endSeq: 56 }]) {
      const hit = result.entries.some((entry) => entry.seq >= block.startSeq && entry.seq < block.endSeq)
      assert.ok(hit, `target=${target} 时块 ${block.startSeq}-${block.endSeq - 1} 没落脚点`)
    }
  }
})
