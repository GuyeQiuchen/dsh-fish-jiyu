/**
 * 约束区边界测试：截断、问句、覆盖方向、优先级、解析回写。
 * 这些是主测试没盖到的角落。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractFromText,
  collectConstraints,
  mergeConstraints,
  renderConstraints,
  parseConstraints,
  prependConstraintEntry,
} from '../lib/constraints.js'

test('截断：超过 60 字的句子截断并加省略号', () => {
  const rows = extractFromText(`不要动 ${'很长的路径'.repeat(12)} 里的文件`)
  assert.equal(rows.length, 1)
  assert.ok(rows[0].text.length <= 60)
  assert.ok(rows[0].text.endsWith('…'))
})

test('问句优先：带「必须」的问句也不抽', () => {
  assert.deepEqual(extractFromText('这个必须改吗？'), [])
})

test('空文本与纯符号：不抽也不炸', () => {
  assert.deepEqual(extractFromText(''), [])
  assert.deepEqual(extractFromText('。。。！！\n\n'), [])
  assert.deepEqual(extractFromText(undefined), [])
})

test('覆盖方向：旧 seq 的新说法不能顶掉更晚的', () => {
  const rows = mergeConstraints(
    [{ kind: 'param', text: '阈值改成 0.5', seq: 200 }],
    [{ kind: 'param', text: '阈值改成 0.35', seq: 100 }],
  )
  assert.equal(rows.length, 1)
  assert.match(rows[0].text, /0\.5/)
})

test('不同类别不互相覆盖', () => {
  const rows = mergeConstraints(
    [{ kind: 'forbid', text: '不要动 memory 里的旧页', seq: 1 }],
    [{ kind: 'require', text: '不要动 memory 里的旧页前先备份', seq: 2 }],
  )
  assert.equal(rows.length, 2)
})

test('继承与新抽的计数分开', () => {
  const checkpoint = renderConstraints([{ kind: 'forbid', text: '不要外发密钥', seq: 5 }])
  const { carried, fresh, rows } = collectConstraints([
    { seq: 50, role: 'other', text: `[Compiled checkpoint]\n${checkpoint}` },
    { seq: 60, role: 'user', text: '叫醒5次10分钟冷却吧' },
  ])
  assert.equal(carried, 1)
  assert.equal(fresh, 1)
  assert.equal(rows.length, 2)
})

test('渲染顺序：禁止类排在目标前面', () => {
  const rows = mergeConstraints(
    [],
    [
      { kind: 'goal', text: '先把局域网做完', seq: 1 },
      { kind: 'forbid', text: '不要暴露端口', seq: 2 },
    ],
  )
  assert.equal(rows[0].kind, 'forbid')
  assert.equal(rows[1].kind, 'goal')
})

test('解析：行尾的「原 seq 已被改」不进入正文', () => {
  const text = renderConstraints([{ kind: 'param', text: '阈值改成 0.5', seq: 200, note: '（原 seq 100 已被 seq 200 改）' }])
  const [row] = parseConstraints(text)
  assert.equal(row.text, '阈值改成 0.5')
  assert.equal(row.seq, 200)
})

test('插入：约束条目永远在第一个', () => {
  const entries = [{ seq: 1, text: '原文', kind: 'text' }]
  const withRow = prependConstraintEntry(entries, '[约束 · 仍然有效]\n- [禁止] 不要外发', 1)
  assert.equal(withRow[0].kind, 'constraint')
  assert.equal(withRow.length, 2)
})

test('插入：空约束不改动原数组', () => {
  const entries = [{ seq: 1, text: '原文', kind: 'text' }]
  assert.equal(prependConstraintEntry(entries, '', 1), entries)
})

test('总字符上限：低优先级的先被丢掉', () => {
  const many = Array.from({ length: 10 }, (_v, i) => ({
    kind: i < 8 ? 'goal' : 'forbid',
    text: `目标${i}：${'说明'.repeat(10)}`,
    seq: i + 1,
  }))
  const rows = mergeConstraints([], many, { maxRows: 10, maxChars: 200 })
  const text = renderConstraints(rows)
  assert.ok(text.length <= 200 + 60, `实际 ${text.length}`)
  assert.ok(rows.some((row) => row.kind === 'forbid'))
})
