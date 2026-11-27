/** 成本模型规划器：一次算出来，不试。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planProjection, TIER_POINTER, TIER_FACT, TIER_RAW } from '../lib/plan.js'

const mk = (n) => Array.from({ length: n }, (_, i) => ({ startSeq: i * 10, endSeq: i * 10 + 9 }))
const costOf = (_i, tier) => ({ 0: 20, 1: 60, 2: 500 })[tier]

test('原文是最近连续的一段', () => {
  const blocks = mk(60)
  const out = planProjection({ blocks, costOf, target: 8000, indexCost: 200 })
  const raw = out.tiers.map((tier, i) => (tier === TIER_RAW ? i : -1)).filter((i) => i >= 0)
  assert.deepEqual(raw, Array.from({ length: out.k }, (_, i) => 60 - out.k + i))
})

test('事实行紧跟原文且连续', () => {
  const blocks = mk(60)
  const out = planProjection({ blocks, costOf, target: 9000, indexCost: 200 })
  const fact = out.tiers.map((tier, i) => (tier === TIER_FACT ? i : -1)).filter((i) => i >= 0)
  if (fact.length > 0) assert.equal(fact[fact.length - 1], 60 - out.k - 1)
  for (let i = 1; i < fact.length; i += 1) assert.equal(fact[i], fact[i - 1] + 1)
})

test('每块都有落脚点（指针兜底）', () => {
  const blocks = mk(200)
  const out = planProjection({ blocks, costOf, target: 3000, indexCost: 200 })
  assert.equal(out.tiers.length, 200)
  assert.equal(out.counts.raw + out.counts.fact + out.counts.pointer, 200)
})

test('不超预算（含索引与预留）', () => {
  const blocks = mk(200)
  const out = planProjection({ blocks, costOf, target: 20000, indexCost: 500, headroom: 0.05 })
  assert.ok(out.tokens <= 20000, `实际 ${out.tokens}`)
})

test('预算越大，原文块越多', () => {
  const blocks = mk(100)
  const small = planProjection({ blocks, costOf, target: 6000, indexCost: 200 }).k
  const large = planProjection({ blocks, costOf, target: 20000, indexCost: 200 }).k
  assert.ok(large > small)
})

test('确定性：两次结果一致', () => {
  const blocks = mk(50)
  const a = planProjection({ blocks, costOf, target: 7000, indexCost: 300 })
  const b = planProjection({ blocks, costOf, target: 7000, indexCost: 300 })
  assert.deepEqual(a.tiers, b.tiers)
})

test('空输入不炸', () => {
  const out = planProjection({ blocks: [], costOf, target: 1000 })
  assert.deepEqual(out.tiers, [])
  assert.equal(out.k, 0)
})

test('中段有硬性份额：不会被指针挤成个位数', () => {
  const blocks = mk(400)
  const out = planProjection({ blocks, costOf, target: 20000, indexCost: 300, factShare: 0.2 })
  assert.ok(out.counts.fact >= 10, `事实行只有 ${out.counts.fact} 条`)
  assert.ok(out.counts.raw > 0, '原文不应归零')
})

test('中段份额不挤爆预算', () => {
  const blocks = mk(400)
  const out = planProjection({ blocks, costOf, target: 20000, indexCost: 300, factShare: 0.3 })
  assert.ok(out.tokens <= 20000, `实际 ${out.tokens}`)
})

test('线上路径：engine=plan 能跑通，三档都有，且不超预算', async () => {
  const { projectRegion } = await import('../lib/linear.js')
  const blocks = mk(200)
  const entries = blocks.map((block) => ({ seq: block.startSeq, text: `第 ${block.startSeq} 块说了点事，还动了工具。` }))
  const out = projectRegion({ entries, blocks, targetTokens: 8000, estimate: (t) => String(t).length, engine: 'plan' })
  assert.ok(out.stats.tokens <= 8000, `超预算 ${out.stats.tokens}`)
  assert.ok(out.stats.keep > 0, '原文块应大于 0')
  assert.ok(out.entries.length > 0)
})
