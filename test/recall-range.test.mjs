/**
 * 取回层的单元测试：事件转文本、区间分页、shadowed 判定。
 * 重点是分页不能漏事件——0.4.3 出过一次。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { textOfEvent, readRange, shadowedSet } from '../lib/recall.js'

const userEvent = (seq, text) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text }] } })
const assistantEvent = (seq, text) => ({
  seq,
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})
const toolResult = (seq, text) => ({ seq, type: 'tool/result', data: { content: [{ type: 'tool-result', content: text }] } })

test('事件转文本：用户、助手、工具三种真实形状', () => {
  assert.equal(textOfEvent(userEvent(1, '你好')), '你好')
  assert.equal(textOfEvent(assistantEvent(2, '收到')), '收到')
  assert.equal(textOfEvent(toolResult(3, 'exit 0')), 'exit 0')
})

test('事件转文本：推理段不进检索', () => {
  const event = { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '草稿' }, { type: 'text', text: '结论' }] } } }
  assert.equal(textOfEvent(event), '结论')
})

test('事件转文本：工具调用拼成一行', () => {
  const event = { seq: 1, type: 'tool/call', data: { name: 'bash', arguments: { command: 'ls' } } }
  assert.match(textOfEvent(event), /\[调用 bash\]/)
})

test('事件转文本：空事件给空串', () => {
  assert.equal(textOfEvent({ seq: 1, type: 'noise' }), '')
  assert.equal(textOfEvent(null), '')
})

test('区间读取：只取区间内的事件', () => {
  const events = [userEvent(1, '一'), userEvent(2, '二'), userEvent(3, '三')]
  const page = readRange(events, 2, 3)
  assert.ok(!page.text.includes('[seq 1]'))
  assert.ok(page.text.includes('[seq 2]'))
  assert.ok(page.text.includes('[seq 3]'))
  assert.equal(page.total, 2)
})

test('区间读取：区间外返回空', () => {
  const page = readRange([userEvent(1, '一')], 5, 9)
  assert.equal(page.text, '')
  assert.equal(page.total, 0)
  assert.equal(page.nextOffset, null)
})

test('区间读取：逐页翻完等于全集（0.4.3 漏事件的那条）', () => {
  const events = []
  for (let i = 1; i <= 12; i += 1) events.push(userEvent(i, '内容'.repeat(i * 3)))
  const seen = []
  let offset = 0
  for (let guard = 0; guard < 50; guard += 1) {
    const page = readRange(events, 1, 12, offset, 60)
    seen.push(...[...page.text.matchAll(/\[seq (\d+)\]/g)].map((match) => Number(match[1])))
    if (page.nextOffset === null) break
    offset = page.nextOffset
  }
  assert.deepEqual([...new Set(seen)].sort((a, b) => a - b), Array.from({ length: 12 }, (_v, i) => i + 1))
})

test('区间读取：分页给出 nextOffset，且最后一页为空', () => {
  const events = [userEvent(1, 'x'.repeat(100)), userEvent(2, 'y'.repeat(100))]
  const first = readRange(events, 1, 2, 0, 80)
  assert.ok(first.nextOffset > 0)
  let page = first
  let guard = 0
  while (page.nextOffset !== null && guard < 20) {
    page = readRange(events, 1, 2, page.nextOffset, 80)
    guard += 1
  }
  assert.equal(page.nextOffset, null)
})

test('区间读取：跳过空文本事件', () => {
  const page = readRange([userEvent(1, ''), userEvent(2, '有内容')], 1, 2)
  assert.equal(page.total, 1)
  assert.ok(page.text.includes('有内容'))
})

test('shadowedSet：按报告块区间收集 seq', () => {
  const report = { blocks: [{ seq: '3-5' }, { seq: '10-12' }] }
  const set = shadowedSet(report)
  for (const seq of [3, 4, 5, 10, 11, 12]) assert.ok(set.has(seq))
  assert.ok(!set.has(6))
})

test('shadowedSet：报告为空 / 坏块不炸', () => {
  assert.equal(shadowedSet({}).size, 0)
  assert.equal(shadowedSet(null).size, 0)
  assert.equal(shadowedSet({ blocks: [{ seq: '坏' }, {}] }).size, 0)
})
