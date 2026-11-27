/**
 * 自己那版编译器的行为锁：角色头只写一次、工具压一行带结果指针、
 * 纯噪声留一行说明、上一份检查点里注入的记忆快照折成指针。
 *
 * 这些串是手对着规则核过的，不是从 vcc 抄的；改了格式就得改这里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileNodes, joinCompiledEntries } from '../lib/compiler/render.js'
import { compileNoisePatterns, DEFAULT_NOISE_PATTERNS } from '../lib/compiler/noise.js'

const budget = { textTokens: 2048, userTextTokens: 4096, toolCallTokens: 128, toolResultExcerptTokens: 0 }
const patterns = compileNoisePatterns(DEFAULT_NOISE_PATTERNS)

function run(nodes, config = {}, budgets = budget) {
  return compileNodes(nodes, { stripNoiseXml: true, noisePatterns: patterns, ...config }, budgets)
}

test('角色头连续同类只写一次，工具调用带 -> result 指针', () => {
  const nodes = [
    { seq: 1, message: { role: 'user', content: [{ type: 'text', text: '你好  ' }], source: { kind: 'user' } } },
    { seq: 2, message: { role: 'assistant', content: [
      { type: 'text', text: '看下文件' },
      { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file_path":"a.js"}' },
    ] } },
    { seq: 3, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'line1\nline2' }] } },
    { seq: 4, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }], source: { kind: 'user' } } },
  ]
  const { entries } = run(nodes)
  assert.deepEqual(entries.map((entry) => entry.text), [
    '[user]\n你好',
    '[assistant]\n看下文件',
    '* read "a.js" (seq 2 -> result 3)',
    '[tool]\nline1\nline2',
    '[user]\n* [user message elided: noise-only] (seq 4)',
  ])
})

test('上一份检查点里的记忆快照折成指针，取回信息仍保留', () => {
  const body = '前 [MNEMON]\n<runtime-memory-file path="A.md">\n内容\n</runtime-memory-file>\n后'
  const nodes = [{ seq: 5, message: { role: 'user', content: [{ type: 'text', text: body }], source: { kind: 'compact-checkpoint' } } }]
  const { entries, stats } = run(nodes, { elideCheckpointInjectedBodies: true })
  assert.equal(stats.elidedCheckpointSpans, 1)
  assert.match(entries[0].text, /^\[system\]\n前 \[注入内容已压缩为指针/)
  assert.match(entries[0].text, /后$/)
})

test('工具结果超预算时留头尾，中间标出处', () => {
  const long = Array.from({ length: 400 }, (_, index) => `row ${index}`).join('\n')
  const nodes = [{ seq: 6, message: { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: long }] } }]
  const { entries } = run(nodes, {}, { ...budget, toolResultExcerptTokens: 20 })
  const text = entries[0].text
  assert.ok(text.startsWith('[tool]\nrow 0'))
  assert.match(text, /\.\.\.\(elided from seq 6\)/)
  assert.ok(text.endsWith('row 399'))
})

test('拼接：连续工具行之间只隔一个换行', () => {
  const entries = [
    { seq: 1, kind: 'tool', text: '* read (seq 1)' },
    { seq: 2, kind: 'tool', text: '* grep (seq 2)' },
    { seq: 3, kind: 'text', text: '[user]\n好' },
  ]
  assert.equal(joinCompiledEntries(entries), '* read (seq 1)\n* grep (seq 2)\n\n[user]\n好')
})

test('冻结的正则也能剥噪声（带 g 时不写 lastIndex）', async () => {
  const { deepFreeze } = await import('../lib/host.js')
  const { stripNoise, compileNoisePatterns, DEFAULT_NOISE_PATTERNS } = await import('../lib/compiler/noise.js')
  const frozen = deepFreeze(compileNoisePatterns(DEFAULT_NOISE_PATTERNS))
  // 一条消息里两段提醒：既验「全剥」，也验「冻结的正则不炸」
  const out = stripNoise('a<system-reminder>1</system-reminder>b<system-reminder>2</system-reminder>c', frozen)
  assert.equal(out, 'abc')
})
