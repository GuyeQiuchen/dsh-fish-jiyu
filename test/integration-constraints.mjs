/**
 * 端到端（离线）验证：约束区真的进了投影结果，而且排在最前、体积可控。
 * 用的是真实会话节点，只是不经过宿主事务。
 *
 * 用法：node test/integration-constraints.mjs [session.v4.jsonl.zstd]
 */
import assert from 'node:assert/strict'
import { parseEvents, toNodes } from './session.mjs'
import { assignBlocks, projectRegion } from '../lib/linear.js'
import { collectConstraints, renderConstraints, prependConstraintEntry } from '../lib/constraints.js'

const sessionFile = process.argv[2] ??
  '/root/.dsh/sessions/--root-workspace--/session-afac32c7-661e-4128-9a42-ba4c7d722d01/session.v4.jsonl.zstd'

const nodes = toNodes(parseEvents(sessionFile))
const blocks = assignBlocks(nodes)
const cut = Math.max(1, Math.floor(blocks.length * 0.7))
const regionNodes = nodes.filter((node) => Number(node.seq) <= Number(blocks[cut - 1].endSeq))
const entries = regionNodes.map((node) => ({ seq: node.seq, kind: 'text', text: node.text }))
const estimate = (text) => Math.ceil(String(text).length / 1.4)
const projected = projectRegion({ entries, blocks: blocks.slice(0, cut), targetTokens: 20000, estimate })
const { rows } = collectConstraints(regionNodes)
const text = renderConstraints(rows)
const withConstraints = prependConstraintEntry(projected.entries, text, Number(regionNodes[0]?.seq ?? 0))

console.log(`节点 ${nodes.length} / 块 ${blocks.length}；压缩前半段 ${regionNodes.length} 节点`)
console.log(`投影条目 ${projected.entries.length}，约束行 ${rows.length}`)

if (text !== '') {
  assert.equal(withConstraints[0].kind, 'constraint', '约束区必须排在第一个')
  assert.ok(withConstraints[0].text.startsWith('[约束'), '第一行必须是约束标题')
  assert.ok(text.length <= 480, `约束区超预算：${text.length}`)
  console.log('约束区：\n' + text)
} else {
  console.log('这段历史里没有可抽的约束（不代表功能失效，换一段含约束的即可）')
}

// 体积：加上约束区之后仍然压得比原文小
const total = withConstraints.reduce((sum, entry) => sum + estimate(entry.text), 0)
console.log(`加约束区后约 ${total} token；约束区本身 ${estimate(text)} token`)
assert.ok(total < estimate(regionNodes.map((node) => node.text).join('\n')), '必须比原文小')

// 再来一轮：把约束区当上一份检查点带回来，必须逐字节一致
const checkpoint = `[Compiled checkpoint]\n${text}\n${projected.entries.map((entry) => entry.text).join('\n')}`
const carried = collectConstraints([{ seq: 999999, role: 'other', text: checkpoint }])
assert.equal(renderConstraints(carried.rows), text, '二次压缩必须逐字节继承')
console.log('继承：二次渲染逐字节一致')
console.log('ALL PASS')
