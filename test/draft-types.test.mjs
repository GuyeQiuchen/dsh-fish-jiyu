/**
 * 草稿类型不该被当成「未知块类型」上报。
 *
 * 背景：0.4.12 的白名单只收 `text`，另一路用 unknownTypesOf 记账上报。
 * 但它原来只跳过 `text`，于是 reasoning / thinking 这两种我们自己排除掉的草稿
 * 也被报成"未知格式"，检查点顶上多一行假的告警。
 * 阿记在她那边（0.4.14）用真实压缩数据发现同一个缺陷，这里是同一处。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

// 与 index.js 里同名的常量保持一致
const DRAFT_TYPES = new Set(['reasoning', 'thinking'])

function unknownTypesOf(message, into) {
  const content = message?.content
  if (!Array.isArray(content) || into === undefined) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (typeof block.text !== 'string' || block.text === '') continue
    const type = String(block.type ?? '(无类型)')
    if (type === 'text') continue
    if (DRAFT_TYPES.has(type)) continue
    into.set(type, (into.get(type) ?? 0) + block.text.length)
  }
}

test('reasoning 不上报', () => {
  const got = new Map()
  unknownTypesOf({ content: [{ type: 'reasoning', text: '做。做。做。' }] }, got)
  assert.equal(got.size, 0)
})

test('thinking 也不上报', () => {
  const got = new Map()
  unknownTypesOf({ content: [{ type: 'thinking', text: '想一想' }] }, got)
  assert.equal(got.size, 0)
})

test('真不认识的类型要按字符累计上报', () => {
  const got = new Map()
  unknownTypesOf(
    { content: [{ type: 'output_text', text: 'hello' }, { type: 'output_text', text: 'x' }] },
    got,
  )
  assert.equal(got.get('output_text'), 6)
})

test('text 和空文本都不计入', () => {
  const got = new Map()
  unknownTypesOf({ content: [{ type: 'text', text: 'aaa' }, { type: 'reasoning', text: '' }] }, got)
  assert.equal(got.size, 0)
})