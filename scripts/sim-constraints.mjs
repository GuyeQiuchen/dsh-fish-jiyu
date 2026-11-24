/**
 * 约束区模拟测试：用真实会话的用户原话当题库。
 *
 * 三个问题：
 *   1. 抽得准不准——对全部真实用户消息跑一遍，人眼审误抽；
 *   2. 抽得全不全——随机抽一部分，看本来该抽的有没有抽到；
 *   3. 压完还在不在——渲染→解析→再渲染必须逐字节一致，第二次压缩不丢。
 *
 * 用法：node scripts/sim-constraints.mjs [session.v4.jsonl.zstd]
 */
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import {
  extractFromText,
  collectConstraints,
  mergeConstraints,
  renderConstraints,
  parseConstraints,
  MAX_CONSTRAINT_ROWS,
} from '../lib/constraints.js'

const FILE = process.argv[2] ??
  '/root/.dsh/sessions/--root-workspace--/session-afac32c7-661e-4128-9a42-ba4c7d722d01/session.v4.jsonl.zstd'

/** 读会话，取「人真正打的字」。 */
function loadUserMessages(file) {
  const raw = readFileSync(file)
  const text = file.endsWith('.zstd') ? zlib.zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8')
  const events = text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const out = []
  for (const event of events) {
    if (!String(event.type ?? '').includes('user')) continue
    const source = event.data?.source ?? event.source
    if (String(source?.kind ?? '') !== 'user') continue
    const content = event.data?.content
    const body = Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => String(p.text ?? '')).join('\n') : String(content ?? '')
    if (body.trim() === '') continue
    out.push({ seq: Number(event.seq), text: body })
  }
  return out
}

/** 固定种子的抽样，保证可复现。 */
function sample(list, count, seed = 20261123) {
  let state = seed
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
  const copy = [...list]
  const picked = []
  while (picked.length < Math.min(count, copy.length)) {
    const index = Math.floor(next() * copy.length)
    picked.push(copy.splice(index, 1)[0])
  }
  return picked
}

const messages = loadUserMessages(FILE)
console.log(`会话用户消息：${messages.length} 条`)

// 1. 全量抽取
const withRows = []
for (const message of messages) {
  const rows = extractFromText(message.text)
  if (rows.length > 0) withRows.push({ ...message, rows })
}
const kinds = {}
for (const item of withRows) for (const row of item.rows) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1
console.log(`\n[1] 抽出约束：${withRows.length} 条消息 / ${Object.values(kinds).reduce((a, b) => a + b, 0)} 行  ${JSON.stringify(kinds)}`)
console.log('—— 全部抽取结果（人工审误抽）——')
for (const item of withRows) {
  console.log(`seq ${item.seq}: ${JSON.stringify(item.text.slice(0, 50))}`)
  for (const row of item.rows) console.log(`   [${row.kind}] ${row.text}`)
}

// 1b. 人工标注的题库：这些 seq 是真的长期约束（正例），其余是干扰项
const GOLD = new Set([4072, 5090, 9135, 12196, 12701, 14033, 14507])
const NEGATIVES = new Set([5979, 6407, 7289, 7586, 13774, 3245, 3632, 13342, 4489, 5893, 6894, 9576])
const got = new Set(withRows.map((item) => item.seq))
const hit = [...GOLD].filter((seq) => got.has(seq))
const falsePos = [...got].filter((seq) => !GOLD.has(seq))
const missed = [...GOLD].filter((seq) => !got.has(seq))
const negativeHits = [...got].filter((seq) => NEGATIVES.has(seq))
console.log(`\n[1b] 题库（人工标 7 正 / 12 负）：命中 ${hit.length}/${GOLD.size}，误抽 ${falsePos.length}（${JSON.stringify(falsePos)}），负例命中 ${negativeHits.length}，漏 ${JSON.stringify(missed)}`)
console.log(`     准确率 ${(hit.length / Math.max(1, hit.length + falsePos.length) * 100).toFixed(0)}%  召回率 ${(hit.length / GOLD.size * 100).toFixed(0)}%`)

// 2. 随机抽样：看有没有该抽没抽的
const picked = sample(messages.filter((m) => extractFromText(m.text).length === 0), 25)
console.log(`\n[2] 随机 25 条「未抽出」的消息，人工看有没有漏——`)
for (const item of picked) console.log(`seq ${item.seq}: ${JSON.stringify(item.text.slice(0, 70))}`)

// 3. 继承与逐字节稳定
const realRows = withRows.slice(0, 12).flatMap((item) => item.rows.map((row) => ({ ...row, seq: item.seq })))
const first = renderConstraints(mergeConstraints([], realRows))
const checkpointText = `[Compiled checkpoint]\n${first}\n[块 seq 1-10] 别的行`
const carried = collectConstraints([{ seq: 999, role: 'other', text: checkpointText }], { maxRows: 8 })
const second = renderConstraints(carried.rows)
console.log(`\n[3] 继承：首轮 ${realRows.length} 行 → 渲染 ${first.split('\n').length - 1} 行，二次渲染${first === second ? '逐字节一致' : '不一致！'}（${second.length} 字符）`)
if (first !== second) {
  console.log('--- first ---\n' + first)
  console.log('--- second ---\n' + second)
}

// 4. 覆盖：同一件事换说法
const oldRow = { kind: 'param', text: '阈值改成 0.35', seq: 100 }
const newRow = { kind: 'param', text: '阈值改成 0.5', seq: 200 }
const merged = mergeConstraints([oldRow], [newRow])
console.log(`\n[4] 覆盖：${JSON.stringify(merged.map((r) => r.text + (r.note ?? '')))}`)

// 5. 预算
const distinct = ['不要动旧页', '必须跑测试', '最多 8 人', '下次大改动再封包', '记得带上会话 id', '不要贴正文', '阈值改成 0.5', '至少保留 3 条', '先做局域网', '跨网以后再说', '禁止外发密钥', '限速 10 分钟 5 次', '只做只读工具', '叫醒轮随自己', '回退包要留']
const many = distinct.map((text, i) => ({
  kind: i % 5 === 0 ? 'forbid' : i % 3 === 0 ? 'param' : 'goal',
  text,
  seq: 1000 + i,
}))
const budgeted = mergeConstraints([], many, { maxRows: MAX_CONSTRAINT_ROWS })
const forbidKept = budgeted.filter((row) => row.kind === 'forbid').length
const totalForbid = many.filter((row) => row.kind === 'forbid').length
console.log(`\n[5] 预算：15 行 → 保留 ${budgeted.length} 行；禁止类 ${forbidKept}/${totalForbid} 保留`)

// 6. 体积
console.log(`\n[6] 体积：${first.length} 字符 ≈ ${Math.round(first.length / 1.4)} token（占 33 万上下文的 ${(first.length / 330000 * 100).toFixed(2)}%）`)
