/**
 * 条目渲染：把一段有序的消息节点压成「一行行条目」（鲫鱼自己的实现）。
 *
 * 规矩就四条：
 *   近段保留原话，但每条有 token 上限，超了留出处注记；
 *   工具调用永远压成一行，只留关键参数和结果指针；
 *   工具结果只留预算内的头尾，其余靠 `-> result N` 取回；
 *   纯噪声（框架注入的提醒）不留内容，留一行说明。
 *
 * 这里不决定「压多长」，只决定「一条长什么样」；总量由 compileRegion 收。
 */
import {
  estimateEntryTokens,
  sanitize,
  truncateWords,
  tailWords,
  countWords,
} from './tokens.js'
import { stripNoise } from './noise.js'
import { elideInjectedBodies, isCheckpointSource, isElidableSource, elidedSourceMarker } from './checkpoint.js'

/** 检查点正文外层框架（宿主认的格式，不能改字）。 */
export const CHECKPOINT_PREAMBLE = 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'
export const CHECKPOINT_OPEN_TAG = '<compacted-checkpoint>'
export const CHECKPOINT_CLOSE_TAG = '</compacted-checkpoint>'

/** 每次检查点开头给模型看的取回指南。 */
export const RECALL_GUIDE = 'RECALL: append-only log — nothing is lost. `recall` restores original content: type "seq", id "3-7"; "result", id "3"; "checkpoint", id "1" (`[checkpoint N]` = dropped). `search` finds by keyword.'

/** 本实现的格式版本，写进报告，用于证明是哪份代码跑的。 */
export const COMPILER_REV = 'jiyu-compiler-1'

/** 每个节点的出处写法。 */
const seqRef = (seq) => `seq ${seq}`

/** 工具一行里保留哪个参数。 */
export const DEFAULT_TOOL_KEY_FIELDS = Object.freeze({
  read: 'file_path',
  edit: 'file_path',
  write: 'file_path',
  glob: 'pattern',
  grep: 'pattern',
  bash: 'command',
  shell: 'command',
  web_search: 'query',
  skill: 'name',
  ralph: 'objective',
  subagent: 'description',
  subagent_fork: 'description',
  create_goal: 'objective',
  update_goal: 'objective',
  workflow: 'name',
  interrupt_agent: 'agent_id',
  job_kill: 'job_id',
  job_output: 'job_id',
  send_message: 'message',
})

/** 这些工具保留关键参数；其余只留名字（记账类工具没有语义值得花 token）。 */
export const DEFAULT_ARG_TOOLS = Object.freeze([
  'read', 'write', 'edit', 'glob', 'grep', 'bash', 'shell', 'web_search',
  'skill', 'subagent', 'subagent_fork', 'ralph', 'workflow',
])

/** 多行参数折成第一行 + `[+ N lines]`。 */
export function oneLineArg(value) {
  const lines = String(value ?? '').split(/\r?\n/u)
  if (lines.length === 1) return lines[0]
  const first = lines[0] !== '' || lines.every((line) => line.trim() === '')
    ? lines[0]
    : lines.find((line) => line.trim() !== '')
  return `${first} [+ ${lines.length - 1} lines]`
}

/** 取关键参数：先按工具白名单，再退到第一个非空字符串参数。 */
export function pickToolKeyArg(name, input, keyFields) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined
  const preferred = keyFields[name]
  if (preferred !== undefined) {
    const value = input[preferred]
    if (typeof value === 'string' && value.length > 0) return value
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** 解析工具参数；不合法就当空（渲染只求不崩）。 */
export function parseToolArguments(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 把工具结果的内容块拼成一段纯文本，图片/文档用标签占位。 */
export function projectToolResultText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block === null || block === undefined) continue
    if (block.type === 'text') {
      const text = sanitize(block.text ?? '')
      if (text.length > 0) parts.push(text)
    } else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'document') parts.push('[document]')
    else parts.push(`[${String(block.type)}]`)
  }
  return parts.join('\n')
}

/** 工具结果的头尾摘录；预算够就原样保留。 */
export function excerptToolResult(text, budget, ref) {
  const overBudget = countWords(text) > budget || text.length > budget * 4
  if (budget <= 0 || !overBudget) return text
  const headLimit = Math.max(8, Math.floor(budget / 2))
  const tailLimit = Math.max(8, budget - headLimit)
  const head = truncateWords(text, headLimit, ref)
  const tail = tailWords(text, tailLimit, ref)
  return `${head.text}\n...(elided from ${ref})\n${tail.text}`
}

/**
 * 把一段有序节点渲染成条目。
 * @param nodes - `{ seq, message }` 序列；message 可能为 null。
 * @param config - 与渲染有关的配置（预算、白名单、是否收 reasoning…）。
 * @param budgets - 可选预算覆盖（收总量时会按比例缩小后重跑）。
 */
export function compileNodes(nodes, config, budgets) {
  const effective = budgets ?? {
    textTokens: config.textTokens,
    userTextTokens: config.userTextTokens,
    toolCallTokens: config.toolCallTokens,
    toolResultExcerptTokens: config.toolResultExcerptTokens,
  }
  const keyFields = { ...DEFAULT_TOOL_KEY_FIELDS, ...(config.toolKeyFields ?? {}) }
  const patterns = config.noisePatterns ?? []
  const argTools = config.toolArgTools?.length > 0 ? config.toolArgTools : DEFAULT_ARG_TOOLS
  const hiddenTools = new Set(config.hideTools ?? [])

  const entries = []
  const stats = {
    nodes: nodes.length,
    entries: 0,
    toolCalls: 0,
    toolResults: 0,
    images: 0,
    documents: 0,
    reasoningElided: 0,
    noiseElided: 0,
    elidedSourceRows: 0,
    elidedSourceChars: 0,
    elidedCheckpointSpans: 0,
    elidedCheckpointChars: 0,
    checkpoints: 0,
    tokens: 0,
    elidedToolRows: 0,
    elidedRows: 0,
  }

  // 先扫一遍：记下每个工具调用 id 对应哪条结果 seq，
  // 这样调用那一行能带 `-> result N`，结果本身不必占条目。
  const resultSeqByCallId = new Map()
  for (const node of nodes) {
    const message = node.message
    if (message === null || message === undefined) continue
    const first = message.content?.[0]
    const resultBlock = first !== undefined && first !== null && first.type === 'tool-result' ? first : undefined
    const callId = typeof message.toolCallId === 'string'
      ? message.toolCallId
      : typeof resultBlock?.toolCallId === 'string'
        ? resultBlock.toolCallId
        : undefined
    if (callId !== undefined) resultSeqByCallId.set(callId, node.seq)
  }

  let lastRole
  let open = false
  const pushEntry = (seq, text, kind) => {
    entries.push({ seq, text, kind })
    stats.entries += 1
    stats.tokens += estimateEntryTokens(text)
  }
  // 同一角色连续的条目只写一次 `[role]` 头。
  const roleHeader = (role) => {
    if (!open || lastRole !== role) {
      open = true
      lastRole = role
      return `[${role}]\n`
    }
    return ''
  }

  for (const node of nodes) {
    const message = node.message
    if (message === null || message === undefined) continue
    if (!Array.isArray(message.content)) continue

    if (message.role === 'assistant') {
      let header = ''
      for (const block of message.content) {
        if (block === null || block === undefined) continue
        if (block.type === 'text') {
          const text = sanitize(block.text ?? '')
          if (text.trim().length === 0) continue
          header = roleHeader('assistant')
          const kept = truncateWords(text, effective.textTokens, seqRef(node.seq))
          pushEntry(node.seq, header + kept.text, 'text')
          continue
        }
        if (block.type === 'reasoning') {
          if (config.includeReasoning !== true) {
            stats.reasoningElided += 1
            continue
          }
          const text = sanitize(block.text ?? '')
          if (text.trim().length === 0) continue
          header = roleHeader('assistant')
          const kept = truncateWords(text, effective.textTokens, seqRef(node.seq))
          pushEntry(node.seq, header + kept.text, 'reasoning')
          continue
        }
        if (block.type === 'tool-call') {
          const name = block.name ?? 'unknown'
          stats.toolCalls += 1
          if (hiddenTools.has(name)) continue
          header = roleHeader('assistant')
          let oneLine
          if (argTools.includes(name)) {
            const parsed = parseToolArguments(block.arguments)
            const arg = pickToolKeyArg(name, parsed, keyFields)
            oneLine = arg === undefined ? `* ${name}` : `* ${name} "${oneLineArg(arg)}"`
          } else {
            oneLine = `* ${name}`
          }
          const resultSeq = resultSeqByCallId.get(block.id)
          const ref = resultSeq === undefined ? seqRef(node.seq) : `${seqRef(node.seq)} -> result ${resultSeq}`
          const kept = truncateWords(oneLine, effective.toolCallTokens, seqRef(node.seq))
          pushEntry(node.seq, header + `${kept.text} (${ref})`, 'tool')
          continue
        }
        if (block.type === 'image') {
          stats.images += 1
          header = roleHeader('assistant')
          pushEntry(node.seq, header + `[image] (${seqRef(node.seq)})`, 'media')
          continue
        }
        if (block.type === 'document') {
          stats.documents += 1
          header = roleHeader('assistant')
          pushEntry(node.seq, header + `[document] (${seqRef(node.seq)})`, 'media')
          continue
        }
        header = roleHeader('assistant')
        pushEntry(node.seq, header + `[${String(block.type)}] (${seqRef(node.seq)})`, 'media')
      }
      continue
    }

    if (message.role === 'tool') {
      stats.toolResults += 1
      const body = projectToolResultText(message.content)
      if (body.length > 0) {
        const header = roleHeader('tool')
        pushEntry(node.seq, header + excerptToolResult(body, effective.toolResultExcerptTokens, seqRef(node.seq)), 'result')
      }
      continue
    }

    if (message.role === 'user') {
      const first = message.content[0]
      if (first !== undefined && first !== null && first.type === 'tool-result') {
        stats.toolResults += 1
        continue
      }
      if (isCheckpointSource(message.source)) {
        stats.checkpoints += 1
        let text = projectToolResultText(message.content)
        if (text.length > 0 && config.elideCheckpointInjectedBodies === true) {
          const collapsed = elideInjectedBodies(text)
          if (collapsed.spans > 0) {
            text = collapsed.text
            stats.elidedCheckpointSpans += collapsed.spans
            stats.elidedCheckpointChars += collapsed.chars
          }
        }
        if (text.length > 0) {
          // 检查点节点在协议里是 user，但它是框架生成的，显示成 [system]。
          pushEntry(node.seq, roleHeader('system') + text, 'checkpoint')
        }
        continue
      }
      if (isElidableSource(message.source, config.elideSourceKinds)) {
        const text = projectToolResultText(message.content)
        if (text.length === 0) continue
        stats.elidedSourceRows += 1
        stats.elidedSourceChars += text.length
        pushEntry(node.seq, `${roleHeader('user')}* ${elidedSourceMarker(message.source.kind, node.seq, text.length)}`, 'note')
        continue
      }
      let surviving = 0
      for (const block of message.content) {
        if (block === null || block === undefined) continue
        if (block.type === 'text') {
          let text = sanitize(block.text ?? '')
          if (config.stripNoiseXml !== false) text = stripNoise(text, patterns)
          if (text.length === 0) continue
          surviving += 1
          const header = roleHeader('user')
          const kept = truncateWords(text, effective.userTextTokens, seqRef(node.seq))
          pushEntry(node.seq, header + kept.text, 'text')
        } else if (block.type === 'image') {
          stats.images += 1
          surviving += 1
          pushEntry(node.seq, roleHeader('user') + `[image] (${seqRef(node.seq)})`, 'media')
        } else if (block.type === 'document') {
          stats.documents += 1
          surviving += 1
          pushEntry(node.seq, roleHeader('user') + `[document] (${seqRef(node.seq)})`, 'media')
        } else {
          const text = sanitize(block.text ?? '')
          if (text.length === 0) continue
          surviving += 1
          const kept = truncateWords(text, effective.userTextTokens, seqRef(node.seq))
          pushEntry(node.seq, roleHeader('user') + kept.text, 'text')
        }
      }
      if (surviving === 0) {
        stats.noiseElided += 1
        pushEntry(node.seq, `${roleHeader('user')}* [user message elided: noise-only] (${seqRef(node.seq)})`, 'note')
      }
    }
  }
  return { entries, stats }
}

/** 缩预算时的地板：对话至少留 32，工具行可以压到 8。 */
const BUDGET_FLOORS = Object.freeze({ textTokens: 32, userTextTokens: 32, toolCallTokens: 8, toolResultExcerptTokens: 8 })

/** 第一轮先丢的条目类型（日志类）。 */
const LOW_VALUE_KINDS = new Set(['result', 'tool', 'media', 'note'])

/** 只缩对话预算；工具行的预算是「整行留或整行丢」，不缩。 */
function scaleBudgets(budgets, factor) {
  const scaled = { ...budgets }
  for (const key of ['textTokens', 'userTextTokens']) {
    scaled[key] = Math.max(BUDGET_FLOORS[key] ?? 8, Math.floor(budgets[key] * factor))
  }
  return scaled
}

/** 被丢条目覆盖的 seq 区间写法。 */
function seqRangeOf(dropped) {
  const first = dropped[0].seq
  const last = dropped[dropped.length - 1].seq
  return first === last ? `seq ${first}` : `seqs ${first}-${last}`
}

/**
 * 渲染整段，并保证总量不超 cap：
 * 先按比例缩预算重跑（最多 4 次），还超就先丢最旧的日志行，再丢最旧的条目。
 * 最新的条目永远保住——越新越值钱。
 */
export function compileRegion(nodes, config) {
  const baseBudgets = {
    textTokens: config.textTokens,
    userTextTokens: config.userTextTokens,
    toolCallTokens: config.toolCallTokens,
    toolResultExcerptTokens: config.toolResultExcerptTokens,
  }
  let budgets = baseBudgets
  let result = compileNodes(nodes, config, budgets)
  let attempts = 0
  while (result.stats.tokens > config.maxTokens && attempts < 4) {
    budgets = scaleBudgets(budgets, (config.maxTokens / result.stats.tokens) * 0.95)
    result = compileNodes(nodes, config, budgets)
    attempts += 1
  }
  let capped = false
  if (result.stats.tokens > config.maxTokens) {
    const entries = result.entries
    const toolRows = []
    while (entries.length > 1 && result.stats.tokens > config.maxTokens) {
      const index = entries.findIndex((entry, position) => position < entries.length - 1 && LOW_VALUE_KINDS.has(entry.kind))
      if (index === -1) break
      const dropped = entries.splice(index, 1)[0]
      result.stats.tokens -= estimateEntryTokens(dropped.text)
      toolRows.push(dropped)
    }
    if (toolRows.length > 0) {
      capped = true
      result.stats.elidedToolRows += toolRows.length
      entries.unshift({ seq: toolRows[0].seq, text: `[${toolRows.length} tool/result entries elided: ${seqRangeOf(toolRows)}]`, kind: 'note' })
      result.stats.tokens += estimateEntryTokens(entries[0].text)
    }
    const elided = []
    const droppedCheckpoints = []
    while (entries.length > 1 && result.stats.tokens > config.maxTokens) {
      const dropped = entries.shift()
      result.stats.tokens -= estimateEntryTokens(dropped.text)
      elided.push(dropped)
      if (dropped.kind === 'checkpoint') droppedCheckpoints.push(dropped)
    }
    if (elided.length > 0) {
      capped = true
      result.stats.elidedRows += elided.length
      // 丢掉的历史检查点必须留名：一行 `[checkpoint N]`，能按编号取回全文。
      const markerLines = [`[${elided.length} earlier entries elided: ${seqRangeOf(elided)}]`]
      for (const dropped of droppedCheckpoints) {
        const ordinal = config.checkpointOrdinals?.get(dropped.seq)
        markerLines.push(`[checkpoint ${ordinal === undefined ? `@ seq ${dropped.seq}` : String(ordinal)}]`)
      }
      entries.unshift({ seq: elided[0].seq, text: markerLines.join('\n'), kind: 'note' })
      result.stats.tokens += estimateEntryTokens(entries[0].text)
    }
    // 2026-11-27 修（审查 B11）：上一个条目是 elided 标记，entries.length 恒 ≥ 2，
    // 这条 `=== 1` 的硬截断永远走不到——maxTokens=1 时照样吐出 54 token。
    // 现在改为「压最大的一条」，把其余条目的用量先扣掉再截。
    const noteOnly = entries.filter((entry) => entry.kind !== 'note')
    const hardCapNeeded = noteOnly.length <= 1 || Number(config.maxTokens) <= 32
    if (result.stats.tokens > config.maxTokens && entries.length >= 1 && hardCapNeeded) {
      let big = 0
      let bigTokens = estimateEntryTokens(entries[0].text)
      for (let i = 1; i < entries.length; i += 1) {
        const tokens = estimateEntryTokens(entries[i].text)
        if (tokens > bigTokens) {
          big = i
          bigTokens = tokens
        }
      }
      const room = config.maxTokens - (result.stats.tokens - bigTokens) - 4
      if (room > 0) {
        capped = true
        const hard = truncateWords(entries[big].text, room, 'total cap')
        entries[big] = { seq: entries[big].seq, text: hard.text, kind: entries[big].kind }
      } else {
        // 连标记都装不下（maxTokens 小到 1）：把最大那条清空，只剩标记。
        // 标记本身约 14 token，这是「必须留名」的下限，再压就得丢可追溯性。
        capped = true
        entries[big] = { seq: entries[big].seq, text: '', kind: entries[big].kind }
      }
      result.stats.tokens = entries.reduce((sum, entry) => sum + estimateEntryTokens(entry.text), 0)
    }
  }
  return { ...result, capped }
}

/** 拼接条目：连续的 tool 行之间只隔一个换行，其余空一行。 */
export function joinCompiledEntries(entries) {
  let out = ''
  let previousKind
  for (const entry of entries) {
    const kind = typeof entry === 'string' ? 'text' : entry.kind
    if (out.length > 0) out += previousKind === 'tool' && kind === 'tool' ? '\n' : '\n\n'
    out += typeof entry === 'string' ? entry : entry.text
    previousKind = kind
  }
  return out
}

/** 套上检查点外壳：前导说明、取回指南、条目、收尾说明。 */
export function frameCheckpoint(entries, headerLine, introLine, footerLine) {
  const body = [RECALL_GUIDE]
  if (introLine !== undefined) body.push(introLine)
  if (headerLine !== undefined) body.push(headerLine)
  body.push(...entries)
  if (footerLine !== undefined) {
    if (Array.isArray(footerLine)) body.push(...footerLine.filter((line) => line !== undefined))
    else body.push(footerLine)
  }
  return [
    { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${CHECKPOINT_OPEN_TAG}` },
    { type: 'text', text: joinCompiledEntries(body) },
    { type: 'text', text: CHECKPOINT_CLOSE_TAG },
  ]
}
