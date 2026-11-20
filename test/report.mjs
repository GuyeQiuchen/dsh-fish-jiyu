/**
 * 压缩决策报告的测试：结构、文本、历史、落盘往返。
 * 删掉决策报告时，连带删掉本文件。
 */
import assert from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  makeReport,
  reportText,
  historyText,
  writeReport,
  readReport,
  readHistory,
  reportPath,
} from '../lib/report.js'

// 一、结构：档位与理由映射成人话，比例算对
const report = makeReport({
  at: '2026-11-18T12:00:00.000Z',
  provider: 'dsh-fish-jiyu',
  cap: 65536,
  target: 32768,
  before: 100000,
  after: 25000,
  stats: {
    tokens: 25000,
    near: 2,
    mid: 3,
    far: 4,
    keep: 2,
    blocks: 9,
    indexWords: 12,
    tiers: [
      { start: 1, end: 9, tier: 0, reason: 'near' },
      { start: 10, end: 19, tier: 1, reason: 'related' },
      { start: 20, end: 29, tier: 2, reason: 'time' },
    ],
  },
  shadowed: { start: 1, end: 99, tokens: 100000 },
})
assert.equal(report.blocks.length, 3)
assert.deepEqual(report.blocks.map((b) => b.tierName), ['原文', '事实行', '关键词'])
assert.deepEqual(report.blocks.map((b) => b.reasonName), ['离得最近', '和当前话题沾边', '按时间距离'])
assert.equal(report.blocks[1].seq, '10-19')
assert.equal(report.ratio, 0.25)
assert.equal(report.summary.blocks, 9)

// 二、文本：体积、块数、逐块档位与理由
const text = reportText(report)
assert.ok(text.includes('遮蔽 seq 1-99'))
assert.ok(text.includes('压完 25000'))
assert.ok(text.includes('原文 2、事实行 3、关键词 4'))
assert.ok(text.includes('seq 20-29 → 关键词（按时间距离）'))

// 三、截断：块太多时只列前几块
const many = makeReport({
  stats: { tokens: 1, tiers: Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, tier: 2, reason: 'time' })) },
})
assert.ok(reportText(many, 3).includes('还有 7 块'))

// 四、落盘：保留最近几次，最新的在前
const home = mkdtempSync(path.join(tmpdir(), 'jiyu-report-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
assert.ok(reportPath().startsWith(home))
assert.equal(writeReport(report), true)
const second = makeReport({ at: '2026-11-18T13:00:00.000Z', before: 200000, after: 40000, stats: { tokens: 40000, tiers: [] } })
assert.equal(writeReport(second), true)
const history = readHistory()
assert.equal(history.length, 2, '应留两条')
assert.equal(history[0].after, 40000, '最新在前')
assert.equal(readReport(0).after, 40000)
assert.equal(readReport(1).after, 25000)
assert.ok(historyText(history).includes('最新'))
assert.ok(historyText(history).includes('第 2 新'))

// 五、旧格式（单个对象而不是数组）也能读
writeFileSync(reportPath(), JSON.stringify(report), 'utf8')
assert.equal(readHistory().length, 1)
assert.equal(readReport(0).after, 25000)

// 六、没有报告时返回 null，不抛
rmSync(home, { recursive: true, force: true })
assert.equal(readReport(), null)
assert.equal(readHistory().length, 0)
assert.ok(historyText([]).includes('还没有'))

// 七、按会话分开存：两个会话各读各的，全局那份仍是最新一次
const home2 = mkdtempSync(path.join(tmpdir(), 'jiyu-report-session-'))
process.env.DSH_HOME = home2
const a1 = makeReport({ session: 'session-a', at: '2026-11-18T14:00:00.000Z', before: 100, after: 10, stats: { tokens: 10, tiers: [] } })
const b1 = makeReport({ session: 'session-b', at: '2026-11-18T15:00:00.000Z', before: 200, after: 20, stats: { tokens: 20, tiers: [] } })
assert.ok(reportPath('session-a').includes('reports'), '会话报告该进 reports 子目录')
assert.ok(!reportPath('session-a').includes('last-report'), '会话报告不该写全局文件')
assert.equal(writeReport(a1), true)
assert.equal(writeReport(b1), true)
assert.equal(readHistory('session-a').length, 1)
assert.equal(readHistory('session-b').length, 1)
assert.equal(readReport(0, 'session-a').after, 10, 'A 会话只看到自己的')
assert.equal(readReport(0, 'session-b').after, 20, 'B 会话只看到自己的')
assert.equal(readReport(0).after, 20, '全局那份跟着最新一次走')
assert.equal(readHistory('session-a')[0].session, 'session-a')

// 同一会话再压一次：只在它自己那条线上累计，不串到别人
writeReport(makeReport({ session: 'session-a', at: '2026-11-18T16:00:00.000Z', before: 300, after: 30, stats: { tokens: 30, tiers: [] } }))
assert.equal(readHistory('session-a').length, 2, 'A 会话该有两条')
assert.equal(readHistory('session-b').length, 1, 'B 会话不受影响')
assert.equal(readReport(0, 'session-a').after, 30)

// 会话 id 里有怪字符也不能当路径用
assert.ok(!reportPath('../../evil').includes('..'), '会话 id 会被消毒')

rmSync(home2, { recursive: true, force: true })

if (previousHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousHome

console.log('report tests: ok')
