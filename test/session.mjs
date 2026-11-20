import fs from 'node:fs'
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export function decodeSession(file) {
  const buf = fs.readFileSync(file)
  const start = buf.indexOf(MAGIC)
  if (start < 0) throw new Error('no zstd magic')
  const parts = []
  let i = start
  while (i < buf.length) {
    const j = buf.indexOf(MAGIC, i + 1)
    if (j < 0) break
    parts.push(buf.subarray(i, j))
    i = j
  }
  parts.push(buf.subarray(start))
  let text = ''
  for (const part of parts) {
    try {
      text += zlib.zstdDecompressSync(part).toString('utf8')
    } catch {
      /* 帧损坏就跳过 */
    }
  }
  return text
}

/** 解析 jsonl → 事件数组（同一 seq 只留最后一条，按 seq 升序）。 */
export function parseEvents(file) {
  const text = decodeSession(file)
  const bySeq = new Map()
  const noSeq = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    // 多帧 zstd 里可能有旧帧残留的重复事件，按 seq 去重（后写的覆盖先写的）。
    if (Number.isFinite(Number(event?.seq))) bySeq.set(Number(event.seq), event)
    else noSeq.push(event)
  }
  return [...bySeq.values()].sort((a, b) => Number(a.seq) - Number(b.seq))
}

/** 事件 → 纯文本（兼容 content 数组与字符串）。 */
export function eventText(event) {
  const message = event?.message ?? event?.data?.message ?? event?.data
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** 事件 → 节点；只取真正带文本的 user/assistant 消息。 */
export function toNodes(events) {
  const nodes = []
  for (const event of events) {
    const type = String(event?.type ?? '')
    const kind = String(event?.data?.source?.kind ?? event?.source?.kind ?? '')
    const isUser = type.includes('user') && kind === 'user'
    const isAssistant = type.includes('assistant')
    if (!isUser && !isAssistant) continue
    const text = eventText(event)
    if (text.trim() === '') continue
    nodes.push({
      seq: Number(event.seq),
      role: isUser ? 'user' : 'assistant',
      injected: type.includes('user') && !isUser,
      text,
      time: event.time ?? event.timestamp,
      tool: '',
    })
  }
  return nodes
}
