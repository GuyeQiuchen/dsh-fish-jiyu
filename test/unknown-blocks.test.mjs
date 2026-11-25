/**
 * 未知块类型上报：草稿是主动排除的，不该混进「未知格式」告警。
 * 2026-11-24 实测：reasoning 24.7 万字被当成未知类型上报，检查点顶上多了一行假警报。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { unknownTypesOf } from '../lib/blocks.js'

const msg = (...blocks) => ({ content: blocks })

test('草稿类型不上报：reasoning / thinking 静默跳过', () => {
  const into = new Map()
  unknownTypesOf(msg(
    { type: 'reasoning', text: '做。做。做。' },
    { type: 'thinking', text: '再核一次' },
  ), into)
  assert.equal(into.size, 0)
})

test('真未知类型上报：按字符累计', () => {
  const into = new Map()
  unknownTypesOf(msg(
    { type: 'output_text', text: '一段结构化输出' },
    { type: 'output_text', text: '第二段' },
  ), into)
  assert.deepEqual([...into.entries()], [['output_text', '一段结构化输出'.length + '第二段'.length]])
})

test('正文块不计入，空文本不计入', () => {
  const into = new Map()
  unknownTypesOf(msg(
    { type: 'text', text: '正常回答' },
    { type: 'output_text', text: '' },
  ), into)
  assert.equal(into.size, 0)
})
