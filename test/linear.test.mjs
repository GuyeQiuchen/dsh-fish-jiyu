/**
 * 线性投影的单元测试：分块、分档、事实行、指针、索引。
 * 全部用合成数据，不依赖会话文件。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  short,
  stripReminders,
  assignBlocks,
  extractKeywords,
  blockKeywords,
  tierOf,
  keepSpans,
  hardMarks,
  factLine,
  hasFactContent,
  keywordLine,
  pointerize,
  projectRegion,
  buildIndexLine,
  parseIndex,
  matchIndex,
} from '../lib/linear.js'

/** 造一个节点。 */
const node = (seq, role, text, tool = '') => ({ seq, role, text, tool, time: 1795400000000 + seq })

test('分块：两条用户发言 → 两个块，区间连续', () => {
  const blocks = assignBlocks([
    node(1, 'user', '第一件事'),
    node(2, 'assistant', '好'),
    node(3, 'user', '第二件事'),
    node(4, 'assistant', '收到'),
  ])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].startSeq, 1)
  assert.equal(blocks[1].startSeq, 3)
  assert.equal(blocks[0].endSeq, blocks[1].startSeq)
})

test('分块：标题取用户原话，不含助手话', () => {
  const [block] = assignBlocks([node(1, 'user', '修一下风扇曲线'), node(2, 'assistant', '好的我去看代码')])
  assert.match(block.title, /风扇/)
  assert.ok(block.quotes.every((quote) => !quote.includes('我去看代码')))
})

test('分块：工具调用记进块里', () => {
  const [block] = assignBlocks([
    node(1, 'user', '跑测试'),
    { seq: 2, role: 'assistant', text: '', tool: 'bash', time: 1795400000002 },
  ])
  assert.ok(block.tools.includes('bash'))
})

test('关键词：有上限、不重复', () => {
  const words = extractKeywords('风扇 风扇 曲线 温度 转速 阈值 测试 日志', 4)
  assert.ok(words.length <= 4)
  assert.equal(new Set(words).size, words.length)
})

test('块关键词：上限生效', () => {
  const [block] = assignBlocks([node(1, 'user', '风扇 曲线 温度 转速 阈值 日志 测试 结果 重跑')])
  assert.ok(blockKeywords(block, 3).length <= 3)
})

test('short：超长截断并加省略号', () => {
  assert.equal(short('一二三四五', 3), '一二…')
  assert.equal(short('短', 3), '短')
})

test('stripReminders：剥掉 system-reminder 包装', () => {
  const text = '前<system-reminder>这段是注入</system-reminder>后'
  assert.match(stripReminders(text), /^前\s*后$/)
})

test('keepSpans：抓路径、带单位数值、原因', () => {
  const spans = keepSpans({
    ending: '改完 C:\\app\\fan.cs 的阈值到 3558 rpm，因为 EC 有停转期',
    quotes: [],
  })
  assert.ok(spans.some((span) => span.includes('fan.cs')))
  assert.ok(spans.some((span) => span.includes('3558 rpm')))
})

test('hardMarks：四种硬信息标记', () => {
  const marks = hardMarks({ text: 'C:\\app\\fan.cs 用 curl 跑，阈值 3558 rpm，报错 ERR_TEST' })
  assert.ok(marks.includes('路'))
  assert.ok(marks.includes('令'))
  assert.ok(marks.includes('数'))
  assert.ok(marks.includes('错'))
})

test('hardMarks：普通闲聊不标', () => {
  assert.deepEqual(hardMarks({ text: '好的，那就先这样吧' }), [])
})

test('factLine：有块头、收尾、取回指引', () => {
  const [block] = assignBlocks([node(7, 'user', '改阈值'), node(8, 'assistant', '改好了')])
  const line = factLine(block, { withEnding: true })
  assert.match(line, /\[块 seq 7-8/)
  assert.match(line, /原文按 seq 取回/)
  assert.match(line, /收尾/)
})

test('factLine：withEnding=false 时不写收尾', () => {
  const [block] = assignBlocks([node(1, 'user', '问'), node(2, 'assistant', '答')])
  assert.ok(!factLine(block, { withEnding: false }).includes('收尾'))
})

test('hasFactContent：空块为假，有标题为真', () => {
  assert.equal(hasFactContent({}), false)
  assert.equal(hasFactContent({ title: '有标题' }), true)
})

test('keywordLine：只有词与指针', () => {
  const line = keywordLine({ startSeq: 3, endSeq: 9, time: 0 }, ['风扇', '曲线'])
  assert.match(line, /\[块 seq 3-8/)
  assert.match(line, /词：风扇 曲线/)
})

test('pointerize：旧检查点折成指针，正文不再出现', () => {
  const [entry] = pointerize([{ seq: 100, kind: 'checkpoint', text: '一大段旧正文' }])
  assert.ok(!entry.text.includes('一大段旧正文'))
  assert.match(entry.text, /seq 100/)
})

test('索引行：词 → seq 区间，可被解析', () => {
  const map = new Map([
    ['风扇', [[1, 9]]],
    ['压缩', [[20, 30], [40, 49]]],
  ])
  const line = buildIndexLine(map)
  assert.match(line.text, /风扇→1-9/)
  assert.match(line.text, /压缩→20-30/)
  const parsed = parseIndex(line.text)
  assert.equal(parsed.length, 2)
})

test('索引匹配：命中词给块，未命中给空', () => {
  const line = buildIndexLine(new Map([['风扇', [[1, 9]]]]))
  const hit = matchIndex(line.text, '风扇')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].word, '风扇')
  assert.deepEqual(matchIndex(line.text, '完全无关的词组'), [])
})

test('索引：超过上限的词会被丢掉', () => {
  const map = new Map()
  for (let i = 0; i < 40; i += 1) map.set(`词${i}`, [[i, i]])
  const line = buildIndexLine(map, 5)
  assert.ok(parseIndex(line.text).length <= 5)
})

test('投影：没有块时原样返回', () => {
  const entries = [{ seq: 1, text: '原文' }]
  const result = projectRegion({ entries, blocks: [] })
  assert.equal(result.entries.length, 1)
  assert.equal(result.stats.blocks, 0)
})

test('投影：预算充足时最近的块保原文', () => {
  const nodes = [node(1, 'user', '甲'), node(2, 'assistant', '乙'), node(3, 'user', '丙'), node(4, 'assistant', '丁')]
  const blocks = assignBlocks(nodes)
  const entries = nodes.map((item) => ({ seq: item.seq, text: item.text, kind: 'text' }))
  const result = projectRegion({ entries, blocks, targetTokens: 10000, estimate: (text) => text.length })
  const near = result.entries.filter((entry) => entry.seq === 3)
  assert.ok(near.length >= 1)
  assert.equal(result.stats.near > 0, true)
})

test('投影：同一输入两次逐字节一致', () => {
  const nodes = [node(1, 'user', '甲'), node(2, 'assistant', '乙'), node(3, 'user', '丙')]
  const blocks = assignBlocks(nodes)
  const entries = nodes.map((item) => ({ seq: item.seq, text: item.text, kind: 'text' }))
  const once = projectRegion({ entries, blocks, targetTokens: 12, estimate: (text) => text.length })
  const twice = projectRegion({ entries: once.entries, blocks, targetTokens: 12, estimate: (text) => text.length })
  assert.deepEqual(once.entries.map((entry) => entry.text), twice.entries.map((entry) => entry.text))
})

test('投影：预算再紧，每个块也有落脚点', () => {
  const nodes = [node(1, 'user', '甲'), node(2, 'assistant', '乙'), node(3, 'user', '丙'), node(4, 'assistant', '丁')]
  const blocks = assignBlocks(nodes)
  const entries = nodes.map((item) => ({ seq: item.seq, text: item.text, kind: 'text' }))
  const result = projectRegion({ entries, blocks, targetTokens: 1, estimate: (text) => text.length })
  const covered = new Set()
  for (const entry of result.entries) {
    for (const block of blocks) {
      if (entry.seq >= block.startSeq && entry.seq < block.endSeq) covered.add(block.startSeq)
    }
  }
  assert.equal(covered.size, blocks.length)
})

test('分档：最近的块是近段', () => {
  const [block] = assignBlocks([node(1, 'user', '甲')])
  assert.equal(tierOf(0, 1, 3, block, []), 0)
})
