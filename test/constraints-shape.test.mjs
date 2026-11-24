/**
 * 回归：真实路径递进来的是 `{ seq, message }`（编译器的形状），
 * 不是 `{ seq, role, text }`。0.4.5 就是在这里断的——单测全绿、真机 0 条。
 * 这个文件只用 message 形状，不许改回 role/text。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectConstraints } from '../lib/constraints.js'

const msg = (role, text) => ({ role, content: [{ type: 'text', text }] })

test('message 形状：能从用户消息里抽出约束', () => {
  const nodes = [
    { seq: 1, message: msg('user', '以后不要用鱼聊聊天了，改成写文件。') },
    { seq: 2, message: msg('assistant', '好。') },
  ]
  const info = collectConstraints(nodes)
  assert.ok(info.rows.length > 0, '应该至少抽出一条')
  assert.equal(info.rows[0].seq, 1)
})

test('message 形状：assistant 的话不算主人的要求', () => {
  const nodes = [{ seq: 3, message: msg('assistant', '你不要再用鱼聊了。') }]
  assert.equal(collectConstraints(nodes).rows.length, 0)
})

test('message 形状：内容为字符串也能读', () => {
  const nodes = [{ seq: 4, message: { role: 'user', content: '以后不要用鱼聊聊天了，改成写文件。' } }]
  assert.ok(collectConstraints(nodes).rows.length > 0)
})

test('两种形状混着来也不炸', () => {
  const nodes = [
    { seq: 5, message: msg('user', '以后先说结论再给细节。') },
    { seq: 6, role: 'user', text: '不要再加新功能了。' },
  ]
  assert.ok(collectConstraints(nodes).rows.length > 0)
})

test('空 message 直接跳过', () => {
  assert.equal(collectConstraints([{ seq: 7, message: null }]).rows.length, 0)
})

test('一次性派活不进约束区：URL 后面跟「评估一下」', () => {
  const nodes = [{ seq: 8, role: 'user', text: 'https://github.com/Yuuyuko-uu/dsh-xingxi评估一下这个类别的记忆插件如何' }]
  assert.equal(collectConstraints(nodes).rows.length, 0)
})

test('一次性派活：帮我看看日志', () => {
  assert.equal(collectConstraints([{ seq: 9, role: 'user', text: '帮我看一下昨晚的日志' }]).rows.length, 0)
})

test('带「不要」的句子仍是规矩，不按派活跳过', () => {
  const nodes = [{ seq: 10, role: 'user', text: '总结文件肯定要重新做啊，不要留误导别人的话' }]
  assert.ok(collectConstraints(nodes).rows.length > 0)
})

test('「改完要测一下」仍是规矩', () => {
  const nodes = [{ seq: 11, role: 'user', text: '改完要测一下再装' }]
  assert.ok(collectConstraints(nodes).rows.length > 0)
})

test('reasoning 草稿不算主人原话，也不进约束', () => {
  const nodes = [{
    seq: 12,
    message: { role: 'user', content: [{ type: 'reasoning', text: '不要再用鱼聊了。' }, { type: 'text', text: '这轮先别动。' }] },
  }]
  const rows = collectConstraints(nodes).rows
  assert.ok(rows.every((row) => !row.text.includes('鱼聊')), JSON.stringify(rows))
})

test('未知块类型：不读它的文本（白名单）', () => {
  const nodes = [{
    seq: 13,
    message: { role: 'user', content: [{ type: 'output_text', text: '不要再用鱼聊了。' }] },
  }]
  assert.deepEqual(collectConstraints(nodes).rows, [])
})
