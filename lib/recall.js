/**
 * 原文取回工具（可删的小模块）。
 *
 * 压缩把远段折成关键词，原文留在会话日志里——但「留在」不等于「拿得到」。
 * 这里补三个只读工具：
 *   jiyu_search  按关键词在被折掉的原文里找，返回命中的 seq 和摘录
 *   jiyu_recall  按 seq 区间把原文读回来，按字符分页，免得一次灌爆
 *   jiyu_blocks  列出最近一次压缩的块（档位、seq 区间、分档理由）
 *
 * 不碰投影、不碰压缩决策、不注册压缩后端。删掉本文件与 tool.js 里那几行即可回退。
 */
import { readReport, TIER_NAMES, TIER_REASONS } from './report.js'

const DEFAULT_PAGE_CHARS = 6000
const SNIPPET_PAD = 60

/**
 * 从事件里抽正文。拿不到就返回空串。
 *
 * 宿主的真实形状是「事件包着消息」：
 *   assistant/message → data.message.content[]
 *   tool/result       → data.message.content[]
 *   tool/call         → data.name + data.arguments
 * 旧形状（data.content / data.text）留作兜底，测试 fixture 也有用。
 * reasoning 段不进检索：那是草稿，不是说过的话。
 */
// 2026-11-22 为什么：0.4.3 只认 data.content / data.text，拿真日志量过——
// 956 条 assistant/message 里 0 条可读、754 条 tool/result 里 0 条可读，
// 也就是 jiyu_search 实际只能搜到用户消息。修好后是 959/960、758/758。
// 验：node test/recall.mjs（第 3 条用真实事件形状比对）
export function textOfEvent(event) {
  const data = event?.data ?? {}
  const msg = data.message ?? data
  const parts = []
  const push = (value) => {
    if (typeof value === 'string' && value.trim() !== '') parts.push(value)
  }
  if (typeof msg.text === 'string') push(msg.text)
  if (typeof data.text === 'string') push(data.text)
  const content = msg.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        push(part)
        continue
      }
      if (part === null || typeof part !== 'object') continue
      const type = String(part.type ?? '')
      // 2026-11-24：白名单。只认「说出口的话」和「工具进出」两类；
      // reasoning/thinking 以及以后宿主新增的类型，一律不进检索（它们没有价值，还会喂回循环）。
      if (type === 'text') {
        if (typeof part.text === 'string') push(part.text)
        continue
      }
      if (type === 'tool-call' || type === 'tool_use') {
        const name = String(part.name ?? part.toolName ?? 'tool')
        push(toolCallLine(name, part.input ?? part.arguments ?? part.args))
        continue
      }
      if (type === 'tool-result' || type === 'tool_result') {
        push(typeof part.content === 'string' ? part.content : '')
        continue
      }
    }
  }
  // tool/call 事件：名字和参数挂在 data 上，不在 content 里
  if (typeof data.name === 'string' && data.arguments !== undefined) {
    push(toolCallLine(data.name, data.arguments))
  }
  if (typeof data.result === 'string') push(data.result)
  return parts.join('\n').trim()
}

function toolCallLine(name, input) {
  let args = ''
  try {
    args = typeof input === 'string' ? input : JSON.stringify(input ?? {})
  } catch {
    args = ''
  }
  return `[调用 ${name}] ${args}`.trim()
}

/** 事件角色，给人看。 */
function roleOf(event) {
  const t = String(event?.type ?? '')
  if (t.startsWith('user/')) return '用户'
  if (t.startsWith('assistant/')) return '助手'
  if (t.startsWith('tool/')) return '工具'
  return t || '事件'
}

/** 把关键词切成词元：空格分开，中文不再拆。 */
function queryTerms(query) {
  return String(query ?? '')
    .split(/[\s,，、]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/** 命中数：几个词出现在同一段文本里。 */
function hitCount(text, terms) {
  const s = String(text ?? '').toLowerCase()
  let n = 0
  for (const t of terms) if (s.includes(t)) n += 1
  return n
}

/** 截一段带上下文的摘录。 */
function snippet(text, term) {
  const s = String(text ?? '').replace(/\s+/g, ' ')
  const lower = s.toLowerCase()
  const at = lower.indexOf(String(term ?? '').toLowerCase())
  if (at < 0) return s.slice(0, SNIPPET_PAD * 2)
  const from = Math.max(0, at - SNIPPET_PAD)
  const to = Math.min(s.length, at + SNIPPET_PAD)
  return `${from > 0 ? '…' : ''}${s.slice(from, to)}${to < s.length ? '…' : ''}`
}

/**
 * 按 seq 区间读原文，按字符分页。
 *
 * offset 是「已经交付过的字符数」；下一页从它接着给。
 * 跳过和写入用同一口径累加，否则 offset 会错位、整条事件被静默丢掉。
 * @returns {{text: string, total: number, nextOffset: number|null, chars: number}}
 */
export function readRange(events, from, to, offset = 0, maxChars = DEFAULT_PAGE_CHARS) {
  const lo = Number(from)
  const hi = Number(to)
  const rows = []
  for (const ev of events) {
    const seq = Number(ev?.seq)
    if (!Number.isFinite(seq) || seq < lo || seq > hi) continue
    const text = textOfEvent(ev)
    if (text === '') continue
    rows.push({ seq, text })
  }
  // 2026-11-22 为什么：原来跳过分支只加 line.length、写入分支加 line.length+1，
  // nextOffset 用两套口径，翻页会静默漏事件（4 条样本里 seq 11 任何一页都取不到）。
  // 现在两个分支统一按「行宽 = 长度 + 换行」记，offset 就是已交付字符数。
  // 验：node test/recall.mjs（逐页翻完，seq 集合必须等于区间全集）
  let remaining = Math.max(0, Number(offset) || 0)
  const lines = []
  let produced = 0
  let nextOffset = null
  for (const row of rows) {
    const line = `[seq ${row.seq}] ${row.text}`
    const width = line.length + 1
    if (remaining > 0) {
      if (remaining >= width) {
        remaining -= width
        continue
      }
      // 2026-11-27 修（审查 B12）：offset 落在某行中间时，这行的前半已经交付过，
      // 原来会把整行再发一遍。现在跳过余下部分，页与页之间不重不漏。
      remaining = 0
      continue
    }
    if (lines.length > 0 && produced + width > maxChars) {
      nextOffset = Math.max(0, Number(offset) || 0) + produced
      break
    }
    lines.push(line)
    produced += width
    remaining = 0
  }
  const text = lines.join('\n')
  return { text, total: rows.length, nextOffset, chars: text.length }
}

/** blocks 里每块的 seq 范围。 */
function blockRange(block) {
  const m = /^(\d+)-(\d+)$/.exec(String(block?.seq ?? ''))
  if (m === null) return null
  return { from: Number(m[1]), to: Number(m[2]), tier: Number(block?.tier ?? 0) }
}

/** 判断某个 seq 是否落在最近一次压缩的范围内。 */
export function shadowedSet(report) {
  const set = new Set()
  const blocks = Array.isArray(report?.blocks) ? report.blocks : []
  for (const block of blocks) {
    const range = blockRange(block)
    if (range === null) continue
    // 报告可能被手改过；区间上限 20 万足够覆盖任何真实会话
    const to = Math.min(range.to, range.from + 200000)
    for (let s = range.from; s <= to; s += 1) set.add(s)
  }
  // 2026-11-27 修（审查 B8）：blocks 只列被折的块；最近那批「原文还在窗口里」的块
  // 不在表里，原来会被标成「在窗口内」——可它其实已经被这次压缩盖住了。
  // 报告的 shadowed 是本次压缩覆盖的完整区间，拿它兜底。
  const shadowed = report?.shadowed
  if (set.size === 0 && shadowed !== null && typeof shadowed === 'object') {
    const from = Number(shadowed.start ?? 0)
    const to = Number(shadowed.end ?? 0)
    if (from > 0 && to >= from) for (let s = from; s <= Math.min(to, from + 200000); s += 1) set.add(s)
  }
  return set
}

/** 先找本会话的报告，找不到退回最近一份（单会话机器上通常是同一份）。 */
function reportFor(exec) {
  const id = String(exec?.agent?.session?.id ?? '')
  try {
    const own = readReport(0, id)
    if (own !== null && typeof own === 'object') return own
  } catch {}
  try {
    const any = readReport(0, '')
    if (any !== null && typeof any === 'object') return any
  } catch {}
  return null
}

function resolveSession(exec) {
  const session = exec?.agent?.session ?? exec?.session
  if (session === null || session === undefined) return null
  // 宿主给的是 Session 对象：snapshotEvents() 是公开读法，events 只是旧形状兜底
  try {
    if (typeof session.snapshotEvents === 'function') {
      const events = session.snapshotEvents()
      if (Array.isArray(events)) return events
    }
  } catch {}
  try {
    const events = session.events
    if (Array.isArray(events)) return events
  } catch {}
  return null
}

function textResult(name, description, parameters, run) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, result) => [{ type: 'text', text: result.text }],
    },
    async execute(args, exec) {
      try {
        return { text: await run(args ?? {}, exec) }
      } catch (error) {
        return { text: `error: ${String(error?.message ?? error)}` }
      }
    },
  }
}

/**
 * 挂三个只读取回工具。
 * @param ctx - 插件上下文。
 * @returns 注册了几个。
 */
export function registerRecallTools(ctx) {
  const tools = ctx?.tools ?? (typeof ctx?.get === 'function' ? ctx.get('tools') : undefined)
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return 0
  const definitions = [
    textResult(
      'jiyu_search',
      '按关键词在被压缩过的原文里搜（只读会话日志，不触发压缩）。返回命中的 seq 和摘录，拿到 seq 后用 jiyu_recall 读回全文。词用空格分隔，命中越多越靠前',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 30 },
          all: { type: 'boolean' },
        },
        required: ['query'],
      },
      (args, exec) => {
        const events = resolveSession(exec)
        if (events === null) return '拿不到当前会话的事件，无法检索'
        const terms = queryTerms(args.query)
        if (terms.length === 0) return 'query 为空'
        const limit = Number(args.limit) || 8
        const report = reportFor(exec)
        const shadowed = args.all === true ? new Set() : shadowedSet(report)
        const scored = []
        for (const ev of events) {
          const text = textOfEvent(ev)
          if (text === '') continue
          const hits = hitCount(text, terms)
          if (hits === 0) continue
          const seq = Number(ev?.seq)
          if (!Number.isFinite(seq)) continue
          scored.push({ seq, hits, faded: shadowed.has(seq), text })
        }
        if (scored.length === 0) return `没搜到：${terms.join(' ')}`
        scored.sort((a, b) => b.hits - a.hits || a.seq - b.seq)
        const lines = scored.slice(0, limit).map((row) => {
          const tag = row.faded ? '已折叠' : '在窗口内'
          return `seq ${row.seq} [${row.hits} 词, ${tag}] ${snippet(row.text, terms[0])}`
        })
        return `命中 ${scored.length} 条（显示前 ${lines.length}）：\n${lines.join('\n')}`
      },
    ),
    textResult(
      'jiyu_recall',
      '按 seq 区间把原文读回来（只读）。会按字符分页，返回 nextOffset 时用同一个 from/to 加 offset 继续。用它核对「当初到底怎么说的」，别凭记忆复述',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'integer', minimum: 0 },
          to: { type: 'integer', minimum: 0 },
          offset: { type: 'integer', minimum: 0 },
          maxChars: { type: 'integer', minimum: 500, maximum: 20000 },
        },
        required: ['from', 'to'],
      },
      (args, exec) => {
        const events = resolveSession(exec)
        if (events === null) return '拿不到当前会话的事件，无法取回'
        const page = readRange(events, args.from, args.to, args.offset ?? 0, Number(args.maxChars) || DEFAULT_PAGE_CHARS)
        if (page.text === '') return `seq ${args.from}-${args.to} 没有可读的正文`
        const tail = page.nextOffset === null ? '（已到末尾）' : `\n还有更多：offset=${page.nextOffset}`
        return `seq ${args.from}-${args.to}（${page.total} 条事件，本页 ${page.chars} 字）\n${page.text}${tail}`
      },
    ),
    textResult(
      'jiyu_blocks',
      '列出最近一次压缩的块：每块落在哪一档（原文/事实行/关键词）、seq 区间、为什么这么分。想知道「哪一段被折成关键词了」时用它，然后拿区间去 jiyu_recall',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          tier: { type: 'integer', minimum: 0, maximum: 2 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      (args, exec) => {
        const report = reportFor(exec)
        if (report === null) return '还没有压缩报告'
        const tier = Number.isInteger(args.tier) ? args.tier : null
        const limit = Number(args.limit) || 40
        const blocks = (Array.isArray(report.blocks) ? report.blocks : [])
          .filter((b) => tier === null || Number(b?.tier) === tier)
          .slice(0, limit)
        if (blocks.length === 0) return '这次压缩没有符合条件的块'
        const head = `压缩于 ${report.at ?? '?'}：${report.before ?? '?'} → ${report.after ?? '?'} tokens，覆盖 seq ${report.seqFrom}-${report.seqTo}`
        const lines = blocks.map((b) => `seq ${b.seq} · ${TIER_NAMES[Number(b.tier)] ?? b.tier} · ${TIER_REASONS[b.reason] ?? b.reason ?? ''}`)
        return `${head}\n${lines.join('\n')}`
      },
    ),
  ]
  let count = 0
  for (const definition of definitions) {
    try {
      // 注册要落在 effect 作用域里：插件卸载时宿主才能回收，重载也不会撞名
      if (typeof ctx?.effect === 'function') ctx.effect(() => tools.register(definition))
      else tools.register(definition)
      count += 1
    } catch (error) {
      console.warn(`compaction-jiyu: ${definition.name} skipped: ${String(error?.message ?? error)}`)
    }
  }
  return count
}
