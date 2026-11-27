/**
 * 报告说真话：after 以实际写进检查点为准；重复安装自检能认出自己。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeReport } from '../lib/report.js'
import { findInstalledCopies } from '../lib/engine/shadow-check.js'

test('after 取调用方给的值，不被 stats.tokens 覆盖', () => {
  const r = makeReport({ after: 400, stats: { tokens: 300, tierTokens: { raw: 300 } } })
  assert.equal(r.after, 400)
  assert.equal(r.summary.constraintTokens, 0)
  assert.equal(r.summary.alertTokens, 0)
})

test('约束区与提醒的 token 单独记账', () => {
  const r = makeReport({ after: 400, stats: { tokens: 300, tierTokens: { raw: 300 } }, constraintTokens: 80, alertTokens: 20 })
  const sum = Object.values(r.summary.tierTokens).reduce((a, b) => a + b, 0)
  assert.equal(sum + r.summary.constraintTokens + r.summary.alertTokens, r.after)
})

test('重复安装自检能认出「当前这份」', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jiyu-shadow-'))
  try {
    const pkg = path.join(root, 'node_modules', 'dsh-fish-jiyu')
    fs.mkdirSync(path.join(pkg, 'lib', 'engine'), { recursive: true })
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-fish-jiyu', version: '9.9.9' }))
    const url = `file://${pkg}/lib/engine/shadow-check.js`
    const copies = findInstalledCopies(url)
    assert.equal(copies.length, 1)
    assert.equal(copies[0].current, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
