/**
 * 报告字段的契约测试：只增不改。
 *
 * 加字段不会失败；改字段名会——因为读报告的人（记忆体的压缩线）拿到
 * undefined 既不报错也不崩溃，只是数字变空，这种坏最难发现。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeReport } from '../lib/report.js'

const REQUIRED = ['at', 'session', 'provider', 'cap', 'target', 'before', 'after', 'ratio', 'seqFrom', 'seqTo', 'summary', 'blocks']
const SUMMARY = ['blocks', 'keep', 'near', 'mid', 'far', 'indexWords']
const BLOCK = ['seq', 'tier', 'tierName', 'reason']

test('报告：必有的顶层字段一个都不能少', () => {
  const report = makeReport({ before: 100, after: 50, stats: { blocks: 1, tiers: [{ start: 1, end: 9, tier: 1, reason: 'old' }] } })
  for (const key of REQUIRED) assert.ok(key in report, `缺字段 ${key}`)
})

test('报告：summary 的字段不缺', () => {
  const report = makeReport({ before: 100, after: 50, stats: { blocks: 1, near: 1, tiers: [] } })
  for (const key of SUMMARY) assert.ok(key in report.summary, `缺 summary.${key}`)
})

test('报告：blocks 每项字段不缺', () => {
  const report = makeReport({ before: 100, after: 50, stats: { blocks: 1, tiers: [{ start: 1, end: 9, tier: 1, reason: 'old' }] } })
  assert.equal(report.blocks.length, 1)
  for (const key of BLOCK) assert.ok(key in report.blocks[0], `缺 blocks[].${key}`)
})

test('报告：加字段不算破坏（constraints 就是后加的）', () => {
  const report = makeReport({ before: 100, after: 50, constraints: { rows: 2 } })
  assert.equal(report.constraints.rows, 2)
})
