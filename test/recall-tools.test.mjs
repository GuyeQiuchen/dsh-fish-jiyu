/**
 * 取回工具层测试：注册形状、调用、无会话时的兜底。
 * 用假 ctx / 假 session，不碰真实日志。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRecallTools } from '../lib/recall.js'

const userEvent = (seq, text) => ({ seq, type: 'user/message', data: { content: [{ type: 'text', text }] } })

/** 造一个最小 ctx 和 session。 */
function setup(events = []) {
  const defs = []
  const ctx = {
    tools: {
      register(definition) {
        defs.push(definition)
      },
    },
    effect(fn) {
      fn()
    },
  }
  const exec = {
    session: {
      snapshotEvents: () => events,
    },
  }
  return { ctx, defs, exec }
}

test('注册：三个工具都挂上', () => {
  const { ctx, defs } = setup()
  assert.equal(registerRecallTools(ctx), 3)
  assert.deepEqual(defs.map((def) => def.name), ['jiyu_search', 'jiyu_recall', 'jiyu_blocks'])
})

test('注册：没有 tools 服务时返回 0，不抛', () => {
  assert.equal(registerRecallTools({}), 0)
  assert.equal(registerRecallTools(null), 0)
})

test('注册形状：每个工具都有 output.schema 和 render', () => {
  const { ctx, defs } = setup()
  registerRecallTools(ctx)
  for (const def of defs) {
    assert.equal(def.output.schema.type, 'object')
    assert.equal(typeof def.output.render, 'function')
  }
})

test('jiyu_recall：按区间取回正文', async () => {
  const { ctx, defs, exec } = setup([userEvent(10, '风扇阈值改到 3558'), userEvent(11, 'EC 有停转期')])
  registerRecallTools(ctx)
  const tool = defs.find((def) => def.name === 'jiyu_recall')
  const result = await tool.execute({ from: 10, to: 11 }, exec)
  assert.match(result.text, /3558/)
  assert.match(result.text, /EC 有停转期/)
})

test('jiyu_recall：区间外说明没有正文', async () => {
  const { ctx, defs, exec } = setup([userEvent(10, '有内容')])
  registerRecallTools(ctx)
  const tool = defs.find((def) => def.name === 'jiyu_recall')
  const result = await tool.execute({ from: 50, to: 60 }, exec)
  assert.match(result.text, /没有可读的正文/)
})

test('jiyu_search：命中给 seq', async () => {
  const { ctx, defs, exec } = setup([userEvent(10, '风扇阈值 3558'), userEvent(11, '别的内容')])
  registerRecallTools(ctx)
  const tool = defs.find((def) => def.name === 'jiyu_search')
  const result = await tool.execute({ query: '风扇' }, exec)
  assert.match(result.text, /seq 10/)
})

test('jiyu_search：没命中给提示', async () => {
  const { ctx, defs, exec } = setup([userEvent(10, '风扇')])
  registerRecallTools(ctx)
  const tool = defs.find((def) => def.name === 'jiyu_search')
  const result = await tool.execute({ query: '完全不存在' }, exec)
  assert.match(result.text, /没搜到/)
})

test('没有 session 时返回中文兜底，不抛异常', async () => {
  const { ctx, defs } = setup()
  registerRecallTools(ctx)
  for (const def of defs) {
    const result = await def.execute({ from: 1, to: 2, query: 'x' }, {})
    assert.equal(typeof result.text, 'string')
    assert.ok(result.text.length > 0)
  }
})
