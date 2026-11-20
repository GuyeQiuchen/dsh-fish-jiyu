/**
 * 离线校准：拿真实会话日志跑一遍新管线（放宽尺度重编 + 三档投影），
 * 和 vcc 的默认编法对照。不碰宿主，纯函数。
 *
 * 用法：node test/calibrate.mjs <会话目录名> [起始seq] [结束seq]
 */
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { parseEvents, eventText } from './session.mjs'
import { assignBlocks, projectRegion, resultDigest } from '../lib/linear.js'

const COMPILER_URL =
  new URL('../lib/vcc/compiler.js', import.meta.url).href
const {
  compileNodes,
  compileRegion,
  estimateEntryTokens,
  compileNoisePatterns,
  DEFAULT_NOISE_PATTERNS,
  DEFAULT_TOOL_KEY_FIELDS,
  DEFAULT_ARG_TOOLS,
} = await import(COMPILER_URL)

const SESSIONS = process.env.DSH_SESSIONS ?? path.join(homedir(), '.dsh', 'sessions')
const name = process.argv[2]
if (name === undefined) {
  console.log('跳过 calibrate：这不是自动测试，需要传一个会话目录名')
  process.exit(0)
}
const file = `${SESSIONS}/${name}/session.v4.jsonl.zstd`
if (!fs.existsSync(file)) throw new Error(`no session file: ${file}`)

const lo = process.env.JIYU_SEQ_LO === undefined ? -Infinity : Number(process.env.JIYU_SEQ_LO)
const hi = process.env.JIYU_SEQ_HI === undefined ? Infinity : Number(process.env.JIYU_SEQ_HI)

const events = parseEvents(file).filter((event) => Number(event.seq) >= lo && Number(event.seq) <= hi)

/** 事件 → 编译器节点（模拟宿主的 deriveEventMessage）。 */
function deriveMessage(event) {
  const type = String(event?.type ?? '')
  const d = event?.data ?? {}
  if (type === 'user/message') return { role: 'user', content: d.content ?? [], source: d.source }
  if (type === 'assistant/message') return d.message ?? null
  if (type === 'tool/call') {
    let input = {}
    try {
      input = JSON.parse(String(d.arguments ?? '{}'))
    } catch {
      input = {}
    }
    return { role: 'assistant', content: [{ type: 'tool_use', id: d.callId, name: d.name, input }] }
  }
  if (type === 'tool/result') return null
  if (type === 'system/message' || type === 'developer/message') return d.message ?? null
  return null
}

const nodes = []
const rawNodes = []
// 工具结果摘要：callId → 最像结论的一行。
const digests = new Map()
const byResult = new Map()
for (const event of events) {
  if (String(event?.type ?? '') !== 'tool/result') continue
  const message = event?.data?.message
  const callId = String(message?.toolCallId ?? message?.source?.callId ?? '')
  const text = (message?.content ?? []).map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n')
  const digest = resultDigest(text)
  if (digest === '') continue
  if (callId !== '') digests.set(callId, digest)
  const error =
    message?.isError === true || /(error|fail|exception|traceback|denied|not found|错误|失败|异常)/i.test(digest)
  byResult.set(Number(event.seq), { digest, error })
}
for (const event of events) {
  const type = String(event?.type ?? '')
  const message = deriveMessage(event)
  if (message !== null && message !== undefined && /^(user|assistant|tool)\//.test(type)) {
    nodes.push({ seq: Number(event.seq), message })
  }
  const kind = String(event?.data?.source?.kind ?? '')
  const isUser = type.includes('user') && kind === 'user'
  const isAssistant = type.includes('assistant')
  rawNodes.push({
    seq: Number(event.seq),
    role: isUser ? 'user' : isAssistant ? 'assistant' : 'other',
    text: isUser || isAssistant ? eventText(event) : '',
    time: event.time ?? event.timestamp,
    tool: type === 'tool/call' ? String(event?.data?.name ?? '') : '',
    note: type === 'tool/call' ? digests.get(String(event?.data?.callId ?? '')) ?? '' : '',
  })
}
const blocks = assignBlocks(rawNodes)

const baseConfig = {
  textTokens: 512,
  userTextTokens: 1024,
  toolCallTokens: 128,
  toolResultExcerptTokens: 0,
  maxTokens: 65536,
  includeReasoning: false,
  stripNoiseXml: true,
  noisePatterns: compileNoisePatterns(DEFAULT_NOISE_PATTERNS),
  toolKeyFields: { ...DEFAULT_TOOL_KEY_FIELDS },
  toolArgTools: DEFAULT_ARG_TOOLS,
  hideTools: [],
}
const rich = { textTokens: 2048, userTextTokens: 4096, toolCallTokens: 128, toolResultExcerptTokens: 0 }

const vccReal = compileRegion(nodes, baseConfig)
const vccRows = compileNodes(nodes, baseConfig, baseConfig)
const generous = compileNodes(nodes, baseConfig, rich)
// 近段失败的工具行补一句结果（和引擎里的 enrichNearEntries 一致）。
const enriched = generous.entries.map((entry) => {
  if (entry.kind !== 'tool') return entry
  const match = /->\s*result\s+(\d+)/.exec(String(entry.text ?? ''))
  if (match === null) return entry
  const info = byResult.get(Number(match[1]))
  if (info === undefined || !info.error) return entry
  return { ...entry, text: `${entry.text} · 结果 ${info.digest}` }
})

const cap = Number(process.env.JIYU_CAP ?? 65536)
const threshold = Number(process.env.JIYU_THRESHOLD ?? 0.35)
const target = Math.max(1, Math.floor(Math.min(cap * threshold * 0.5, Math.max(generous.stats.tokens, vccReal.stats.tokens) * 0.85)))
const projected = projectRegion({
  entries: enriched,
  blocks,
  targetTokens: target,
  estimate: estimateEntryTokens,
  nearBlocks: 3,
  midMax: 140,
  farWords: 6,
})

const line = (label, stats) =>
  `${label.padEnd(14)} ${String(stats.entries).padStart(5)} 条 / ${String(stats.tokens).padStart(7)} tokens` +
  (stats.near === undefined ? '' : `（近 ${stats.near}·中 ${stats.mid}·远 ${stats.far}·索引词 ${stats.indexWords}）`)

console.log(`会话：${name}${lo === -Infinity ? '' : ` · seq ${lo}-${hi}`}`)
console.log(`节点 ${nodes.length} · 块 ${blocks.length}`)
console.log(line('vcc 实际', vccReal.stats))
console.log(line('vcc 逐条原样', vccRows.stats))
console.log(line('放宽尺度重编', generous.stats))
console.log(line('三档投影', { ...projected.stats, entries: projected.entries.length }))
console.log(`上限 ${cap} · 目标 ${target} · 相对重编压到 ${(100 * projected.stats.tokens / Math.max(1, generous.stats.tokens)).toFixed(1)}%`)

// 近段是否真的更接近原话：挑最长的一段 assistant 正文，比两版渲染长度。
let longest = null
for (const node of nodes) {
  const content = node.message?.content
  if (!Array.isArray(content) || node.message?.role !== 'assistant') continue
  const text = content.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n')
  if (longest === null || text.length > longest.length) longest = { seq: node.seq, length: text.length }
}
if (longest !== null) {
  const pick = (compiled) => compiled.entries.filter((e) => e.seq === longest.seq).map((e) => e.text).join('\n')
  console.log(`\n最长 assistant（seq ${longest.seq}，原文 ${longest.length} 字）渲染后：vcc ${pick(vccRows).length} 字 / 重编 ${pick(generous).length} 字`)
}

const index = projected.entries.find((e) => String(e.text ?? '').startsWith('[关键词索引]'))
console.log(`索引行：${index === undefined ? '无' : `${index.text.length} 字`}`)
const sampleFar = projected.entries.find((e) => /^\[块 seq \d+.*词：/.test(String(e.text ?? '')))
if (sampleFar !== undefined) console.log(`远段样例：${sampleFar.text.slice(0, 150)}`)
