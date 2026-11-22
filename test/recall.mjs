import assert from 'node:assert'
import { textOfEvent, readRange, shadowedSet } from '../lib/recall.js'

const events = [
  { seq: 10, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '先装插件，注意 install.sh 别重复插条目' }] } } },
  { seq: 11, type: 'assistant/message', data: { message: { role: 'assistant', content: [
    { type: 'reasoning', text: '这是草稿，不该进检索' },
    { type: 'text', text: '好，先看 profile 里的 package.json' },
    { type: 'tool-call', name: 'bash', input: { cmd: 'ls' } },
  ] } } },
  { seq: 12, type: 'tool/call', data: { name: 'bash', arguments: '{"cmd":"ls"}' } },
  { seq: 13, type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: 'package.json cordis.patch.yml' }] } } },
  { seq: 14, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '今天吃什么' }] } } },
]

// 一、抽取正文
assert.ok(textOfEvent(events[0]).includes('install.sh'))
assert.ok(textOfEvent(events[1]).includes('[调用 bash]'))
assert.ok(!textOfEvent(events[1]).includes('草稿'), 'reasoning 不该进检索')
assert.ok(textOfEvent(events[2]).includes('[调用 bash]'), 'tool/call 的名字和参数')
assert.ok(textOfEvent(events[3]).includes('cordis.patch.yml'), 'tool/result 的正文')
assert.equal(textOfEvent({ seq: 1, type: 'x', data: {} }), '')

// 二、按区间取回
{
  const page = readRange(events, 10, 13)
  assert.ok(page.text.includes('seq 10'))
  assert.ok(!page.text.includes('seq 14'), '区间外的不要')
  assert.equal(page.total, 4)
  assert.equal(page.nextOffset, null)
}

// 三、分页：逐页翻完，每条事件都要出现且只出现一次
{
  const seen = new Set()
  let offset = 0
  let guard = 0
  for (;;) {
    const page = readRange(events, 10, 13, offset, 30)
    for (const m of page.text.matchAll(/\[seq (\d+)\]/g)) seen.add(m[1])
    if (page.nextOffset === null) break
    offset = page.nextOffset
    assert.ok(guard++ < 50, '分页不该死循环')
  }
  assert.deepEqual([...seen].sort(), ['10', '11', '12', '13'], '每条事件都要能翻到')
}

// 四、blocks → 折叠集合
{
  const set = shadowedSet({ blocks: [{ seq: '10-12', tier: 2 }, { seq: '20-21', tier: 1 }] })
  assert.equal(set.size, 3 + 2)
  assert.ok(set.has(10) && set.has(12) && set.has(20))
  assert.ok(!set.has(13))
  // 手改过的离谱区间不该把进程卡死
  const huge = shadowedSet({ blocks: [{ seq: '0-99999999', tier: 2 }] })
  assert.ok(huge.size <= 200001)
}

console.log('recall tests: ok')
