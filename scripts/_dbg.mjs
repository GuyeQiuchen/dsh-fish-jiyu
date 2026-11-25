import { parseEvents, toNodes } from '../test/session.mjs'
import { assignBlocks, projectRegion } from '../lib/linear.js'
const nodes = toNodes(parseEvents(process.argv[2]))
const blocks = assignBlocks(nodes)
const cut = Math.max(1, Math.floor(blocks.length * 0.7))
const region = nodes.filter(n => Number(n.seq) <= Number(blocks[cut-1].endSeq))
const entries = region.map(n => ({ seq: n.seq, kind: 'text', text: n.text }))
const estimate = (t) => Math.ceil(String(t).length / 1.4)

// 用 projectRegion 自己算不出来内部分支，这里复算各档体积
const p = projectRegion({ entries, blocks: blocks.slice(0, cut), targetTokens: 40000, estimate })
const kinds = new Map()
for (const e of p.entries) {
  const t = String(e.text)
  const k = t.startsWith('[关键词索引]') ? '索引' : t.includes('词：') ? '远' : t.includes('原文按 seq 取回') ? '中' : '近'
  kinds.set(k, (kinds.get(k) ?? 0) + estimate(t))
}
console.log('target 40000 分档:', JSON.stringify([...kinds.entries()]), '合计', [...kinds.values()].reduce((a,b)=>a+b,0))
console.log('stats:', JSON.stringify(p.stats))
// 看看 entries 里 seq 的范围，loose 有没有
const seqs = p.entries.map(e => Number(e.seq)).filter(n => !isNaN(n))
console.log('seq 范围:', Math.min(...seqs), '-', Math.max(...seqs), '条目', p.entries.length)