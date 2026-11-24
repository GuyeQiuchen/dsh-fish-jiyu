/**
 * 约束区测试：抽得准、抽得少、压两次还在、超预算不丢禁止。
 * 运行：node --test test/constraints.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractFromText,
  collectConstraints,
  mergeConstraints,
  renderConstraints,
  parseConstraints,
  MAX_CONSTRAINT_ROWS,
} from '../lib/constraints.js'

test('抽得准：禁止 / 参数 / 流程要求', () => {
  assert.deepEqual(extractFromText('不要动 memory 里的旧页'), [{ kind: 'forbid', text: '不要动 memory 里的旧页' }])
  assert.equal(extractFromText('叫醒5次10分钟冷却吧')[0].kind, 'param')
  assert.equal(extractFromText('最多 8 人，满了拒绝')[0].kind, 'param')
  assert.equal(extractFromText('修，修完测试，没问题就封包')[0].kind, 'require')
  assert.equal(extractFromText('改动要做，改完你要测试，没问题你就装在自己身上')[0].kind, 'require')
})

test('不误抽：问句、事实、举例', () => {
  const negatives = [
    'qwen3.6-35b-a3b如果是q4级别的精度能做到v4.1flash的几成实力',
    '为什么电脑使用云端显示的是200token/s',
    '你能按 0-500做一个注意力衰退曲线吗',
    '目前ai写的风扇控制软件会因为EC有20秒的低温风扇停转期。',
    '但是按你的说法，只留五条，其他沉掉，会不会导致沉掉的内容就直接遗忘了',
    '比如阈值改成 0.35 会怎样',
    '我们对话了多少轮次了',
  ]
  for (const text of negatives) assert.deepEqual(extractFromText(text), [], text)
})

test('覆盖：同一件事的新说法顶掉旧说法，并留痕', () => {
  const rows = mergeConstraints(
    [{ kind: 'param', text: '阈值改成 0.35', seq: 100 }],
    [{ kind: 'param', text: '阈值改成 0.5', seq: 200 }],
  )
  assert.equal(rows.length, 1)
  assert.match(rows[0].text, /0\.5/)
  assert.match(rows[0].note, /seq 100/)
})

test('去重：只是说法相近、没有改动的，不重复堆叠', () => {
  const rows = mergeConstraints(
    [{ kind: 'forbid', text: '不要动 memory 里的旧页', seq: 1 }],
    [{ kind: 'forbid', text: '不要动 memory 里的旧页面', seq: 2 }],
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].seq, 1)
})

test('预算：15 条不同约束只留 8 条，禁止类优先', () => {
  const many = Array.from({ length: 15 }, (_v, i) => ({
    kind: i < 3 ? 'forbid' : i < 6 ? 'param' : 'goal',
    text: `第${i + 1}条：${'说明'.repeat(i % 3)}${i}`,
    seq: 100 + i,
  }))
  const rows = mergeConstraints([], many, { maxRows: MAX_CONSTRAINT_ROWS })
  assert.ok(rows.length <= MAX_CONSTRAINT_ROWS)
  assert.equal(rows.filter((row) => row.kind === 'forbid').length, 3)
})

test('继承：渲染 → 解析 → 再渲染逐字节一致', () => {
  const rows = [
    { kind: 'forbid', text: '不要动 memory 里的旧页', seq: 11 },
    { kind: 'param', text: '最多 8 人', seq: 22 },
    { kind: 'require', text: '改完要测试，没问题就装', seq: 33 },
  ]
  const first = renderConstraints(rows)
  const checkpoint = `[Compiled checkpoint]\n${first}\n[块 seq 1-10] 别的行`
  const carried = collectConstraints([{ seq: 99, role: 'other', text: checkpoint }])
  assert.equal(renderConstraints(carried.rows), first)
  assert.equal(carried.rows.length, 3)
})

test('没有约束就不占地方', () => {
  assert.equal(renderConstraints([]), '')
  assert.deepEqual(parseConstraints(''), [])
})

test('从待压节点里抽：用户话进、检查点继承', () => {
  const nodes = [
    { seq: 10, role: 'user', text: '不要动 memory 里的旧页。这个插件完善了我再让他装' },
    { seq: 11, role: 'assistant', text: '好的' },
    { seq: 12, role: 'user', text: '叫醒5次10分钟冷却吧' },
  ]
  const { rows } = collectConstraints(nodes)
  assert.equal(rows.length, 2)
  assert.equal(rows.filter((row) => row.kind === 'forbid').length, 1)
  assert.equal(rows.filter((row) => row.kind === 'param').length, 1)
})

test('约束行体积可控', () => {
  const long = 'x'.repeat(200) + '不要动 memory 里的旧页'
  const rows = mergeConstraints([], extractFromText(long).map((row) => ({ ...row, seq: 1 })))
  const text = renderConstraints(rows)
  assert.ok(text.length <= 480, `实际 ${text.length}`)
})
