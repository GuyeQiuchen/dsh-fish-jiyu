/** 安装脚本：撤销以前写进 profile 的 2000/1200/500。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { clearPrunerOverride } from '../scripts/clear-tool-pruner.mjs'

const legacy = `- id: compaction-basic
  disabled: true

- id: tool-result-pruner
  config:
    thresholdChars: 2000
    headChars: 1200
    tailChars: 500

- id: fish-chat
  config:
    wake: false
`

test('撤销我们设的三项，别的条目一个字不动', () => {
  const out = clearPrunerOverride(legacy)
  assert.equal(out.changed, true)
  assert.doesNotMatch(out.text, /thresholdChars: 2000/)
  assert.doesNotMatch(out.text, /headChars: 1200/)
  assert.match(out.text, /- id: tool-result-pruner/)
  assert.match(out.text, /- id: fish-chat/)
  assert.match(out.text, /wake: false/)
})

test('别人的自定义阈值不碰', () => {
  const custom = legacy.replace('2000', '4000').replace('1200', '3000').replace('500', '800')
  const out = clearPrunerOverride(custom)
  assert.equal(out.changed, false)
  assert.equal(out.reason, 'custom-values')
  assert.equal(out.text, custom)
})

test('已经是默认（没有 config）：什么都不做', () => {
  const out = clearPrunerOverride('- id: tool-result-pruner\n\n- id: fish-chat\n  config:\n    wake: false\n')
  assert.equal(out.changed, false)
  assert.equal(out.reason, 'already-default')
})

test('没有这一条：也什么都不做', () => {
  const out = clearPrunerOverride('- id: compaction-basic\n  disabled: true\n')
  assert.equal(out.changed, false)
  assert.equal(out.reason, 'no-row')
})

test('幂等：撤两次结果一样', () => {
  const once = clearPrunerOverride(legacy).text
  assert.equal(clearPrunerOverride(once).text, once)
})
