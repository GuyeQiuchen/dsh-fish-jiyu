/**
 * 决策报告测试：字段、比例、文本渲染、历史概览。
 * 纯函数，不写磁盘。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeReport, reportText, historyText } from '../lib/report.js'

const sample = () =>
  makeReport({
    session: 's1',
    provider: 'linear',
    cap: 1000,
    target: 400,
    before: 800,
    after: 200,
    seqFrom: 10,
    seqTo: 20,
    constraints: { rows: 3, carried: 1, fresh: 2 },
    stats: { blocks: 2, keep: 1, near: 1, mid: 1, far: 0, indexWords: 4, tiers: [] },
  })

test('makeReport：基本字段齐全', () => {
  const report = sample()
  assert.equal(report.session, 's1')
  assert.equal(report.before, 800)
  assert.equal(report.after, 200)
  assert.equal(report.seqFrom, 10)
  assert.equal(report.seqTo, 20)
})

test('makeReport：比例按 before/after 算', () => {
  assert.equal(sample().ratio, 0.25)
})

test('makeReport：before 为 0 时比例为 null', () => {
  assert.equal(makeReport({ before: 0, after: 10 }).ratio, null)
})

test('makeReport：约束字段透传', () => {
  assert.deepEqual(sample().constraints, { rows: 3, carried: 1, fresh: 2 })
})

test('makeReport：没给约束时是 null', () => {
  assert.equal(makeReport({ before: 10, after: 5 }).constraints, null)
})

test('reportText：含时间、provider、上限与目标', () => {
  const text = reportText(sample())
  assert.match(text, /压缩报告/)
  assert.match(text, /linear/)
  assert.match(text, /上限 1000，目标 400/)
})

test('reportText：含档位统计', () => {
  const text = reportText(sample())
  assert.match(text, /原文 1、事实行 1、关键词 0/)
  assert.match(text, /索引词 4/)
})

test('reportText：maxBlocks 限制行数并提示剩余', () => {
  const report = makeReport({
    before: 100,
    after: 50,
    stats: {
      blocks: 5,
      tiers: Array.from({ length: 5 }, (_v, i) => ({ start: i * 10, end: i * 10 + 9, tier: 1, reason: 'old' })),
    },
  })
  const text = reportText(report, 2)
  assert.match(text, /…还有 3 块/)
})

test('historyText：空列表给提示', () => {
  assert.match(historyText([]), /还没有压缩记录/)
})

test('historyText：最新在前，标出比例', () => {
  const text = historyText([
    { at: '2026-11-23T05:00:00Z', before: 800, after: 200, ratio: 0.25, summary: { blocks: 3 } },
    { at: '2026-11-22T05:00:00Z', before: 900, after: 300, ratio: 0.333, summary: { blocks: 4 } },
  ])
  assert.match(text, /^最新/)
  assert.match(text, /25%/)
  assert.match(text, /第 2 新/)
})
