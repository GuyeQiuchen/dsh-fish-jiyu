/**
 * 会话体量提醒：过 6 万条顶一行，平时必须一个字都不占。
 * 这不是功能，是「该做分卷了」的信号必须被推到眼前——靠想起不可靠。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionAlert, SESSION_WARN_AT, SESSION_EVENT_LIMIT } from '../lib/linear.js'
import { makeReport } from '../lib/report.js'

test('没到线：返回空串', () => {
  assert.equal(sessionAlert(SESSION_WARN_AT - 1), '')
  assert.equal(sessionAlert(0), '')
})

test('到线：带条数、剩余量和去处', () => {
  const line = sessionAlert(SESSION_WARN_AT)
  assert.match(line, new RegExp(String(SESSION_WARN_AT)))
  assert.match(line, /分卷/)
  assert.match(line, /projects\/jiyu-limits/)
})

test('过门槛：剩余量不为负', () => {
  const line = sessionAlert(SESSION_EVENT_LIMIT + 500)
  assert.match(line, /还差 0/)
})

test('报告带上 sessionEvents，便于事后核', () => {
  const r = makeReport({ before: 1, after: 1, sessionEvents: 61234 })
  assert.equal(r.sessionEvents, 61234)
})
