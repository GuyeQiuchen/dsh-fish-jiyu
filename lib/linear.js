import { planProjection, TIER_RAW, TIER_FACT, TIER_POINTER } from './plan.js'

/**
 * 线性投影：把一段待压历史按「距离」投成三档。
 *
 *   近段（最新几块）  —— 原文，逐条保留；
 *   中段              —— 每块一行事实（时间、你的话、做了什么、收尾、seq 区间）；
 *   远段              —— 每块只留关键词，另有一条全局关键词索引（词 → seq 区间）。
 *
 * 和 fold（dsh-fish-fold）的区别：fold 是「块摘要」，远块仍是一行自然语言；
 * 这里是「投影」，远块只剩词，词能直接拿去做日志检索（search/recall），
 * 所以远段记忆的代价是一串词，不是一段叙事，也不会因为摘要叠加而滚雪球。
 *
 * 全部纯函数，不碰 ctx、不调模型，方便离线拿真实日志做对照。
 */

const BLOCK_HEAD = '[块'
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** 中文虚字：bigram 里含这些字的一律不算关键词。 */
const HAN_STOP = new Set(
  '的了我你他她它这那就都还要在有和与把被让给对从到于是但而所以因为如果吗呢吧啊哦嗯很太再又已更最不没会能可么什怎为以于将并且则其之也着过起来去得地是个些真挺好嘛呀'.split(''),
)

/** 英文虚词。 */
const ASCII_STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'you', 'are', 'was', 'were', 'not', 'but',
  'have', 'has', 'had', 'from', 'they', 'them', 'their', 'will', 'would', 'can', 'could',
  'what', 'when', 'then', 'than', 'your', 'our', 'out', 'into', 'about', 'just', 'like',
  'also', 'all', 'any', 'one', 'two', 'use', 'using', 'get', 'got', 'new', 'now', 'yes',
  'no', 'ok', 'okay', 'here', 'there', 'which', 'while', 'been', 'being', 'does', 'did',
  'make', 'made', 'some', 'such', 'only', 'very', 'more', 'most', 'much', 'many', 'each',
])

/**
 * 剥掉注入进用户消息的系统提醒，留下人真正说的话。
 * @param text - 原始文本。
 * @returns 剥完的文本。
 */
export function stripReminders(text) {
  return String(text ?? '').replace(REMINDER_RE, ' ').trim()
}

/** 去掉落在末尾的孤立代理项（一个 emoji 被切一半时会出现）。 */
function trimBrokenSurrogate(text) {
  const chars = [...text]
  if (chars.length === 0) return text
  const last = chars[chars.length - 1].codePointAt(0)
  if (last >= 0xd800 && last <= 0xdfff) return chars.slice(0, -1).join('')
  return text
}

/** 压成一行：去代码块、去 markdown 记号、收空白。 */
export function short(text, maxChars) {
  const flat = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= maxChars) return flat
  // 2026-11-27 修（审查 B10）：按 UTF-16 下标切会切出半个代理对（emoji 变 \ud83d）。
  // 用码点切，末尾再确认不是孤立代理。
  const chars = [...flat]
  if (chars.length <= maxChars) return flat
  return `${trimBrokenSurrogate(chars.slice(0, Math.max(0, maxChars - 1)).join(''))}…`
}

/**
 * 工具结果摘要：只留最像结论的那一行（报错优先，其次末行），供中段事实行引用。
 * 结果原文有一百多万 token，不能全留；但「跑成没成、报了什么错」是记忆里最值钱的一行。
 * @param text - 结果原文。
 * @param maxChars - 摘要最大字符数。
 * @returns 摘要（可能为空串）。
 */
export function resultDigest(text, maxChars = 48) {
  const lines = String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return ''
  const bad = lines.find((line) => /(error|fail|exception|traceback|denied|not found|错误|失败|异常|找不到|拒绝)/i.test(line))
  const pick = bad ?? lines[lines.length - 1]
  const flat = pick.replace(/\s+/g, ' ')
  return flat.length <= maxChars ? flat : `${flat.slice(0, Math.max(0, maxChars - 1))}…`
}

/** 时间戳 → 本地 MM-DD HH:mm。 */export function stamp(time) {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 把节点切成话题块：一条真正的用户发言开一个新块。
 * @param nodes - `{ seq, role, text, time, tool }[]`，按 seq 升序。
 * @param options - titleChars 标题长度、maxQuotes 每块留几句原话。
 * @returns 块数组。
 */
export function assignBlocks(nodes, options = {}) {
  const titleChars = options.titleChars ?? 24
  const maxQuotes = options.maxQuotes ?? 3
  const blocks = []
  let current = null
  for (const node of nodes) {
    const said = node.role === 'user' ? stripReminders(node.text) : ''
    const opensBlock = node.role === 'user' && said !== ''
    if (current === null || opensBlock) {
      if (current !== null) blocks.push(current)
      current = {
        startSeq: Number(node.seq),
        endSeq: Number(node.seq) + 1,
        time: node.time,
        title: opensBlock ? short(said, titleChars) : '',
        count: 0,
        quotes: [],
        ending: '',
        tools: [],
        files: [],
        notes: [],
        text: '',
      }
    }
    current.endSeq = Number(node.seq) + 1
    current.count += 1
    const text = String(node.text ?? '')
    current.text = `${current.text}\n${text}`
    if (opensBlock) {
      const quote = short(said, 60)
      if (quote !== '' && current.quotes.length < maxQuotes) current.quotes.push(quote)
    } else if (node.role === 'assistant' && text !== '') {
      current.ending = short(text, 36)
    }
    const tool = String(node.tool ?? '').trim()
    if (tool !== '' && !current.tools.includes(tool) && current.tools.length < 4) current.tools.push(tool)
    // 工具结果摘要：只留几句最像结论的，挂在块上给中间段那行事实用。
    const note = String(node.note ?? '').trim()
    if (note !== '' && !current.notes.includes(note) && current.notes.length < 3) current.notes.push(note)
  }
  if (current !== null) blocks.push(current)
  return blocks
}

/**
 * 从一段文本抽关键词：十六进制记号、英文词、中文 n-gram（2–4 字，取极大片段）。
 *
 * 中文没有分词器，直接取 bigram 会得到「上下」「下文」这种半截词；这里改用
 * 「频次 ≥2 的 n-gram，再去掉被更长片段包含的」，重复出现的「上下文」会顶掉
 * 它的两个半截，单次出现的词也不会全丢（候选为空时退回 bigram）。
 * @param text - 文本。
 * @param max - 最多几个。
 * @returns 关键词数组，按权降序。
 */
export function extractKeywords(text, max = 8) {
  const counts = new Map()
  const bump = (word, weight = 1) => {
    if (word === '') return
    counts.set(word, (counts.get(word) ?? 0) + weight)
  }
  const str = String(text ?? '')
  for (const match of str.matchAll(/0x[0-9a-f]{2,6}/gi)) bump(match[0].toLowerCase(), 4)
  for (const match of str.matchAll(/[A-Za-z][A-Za-z0-9_.\-]{2,}/g)) {
    const word = match[0].toLowerCase()
    if (ASCII_STOP.has(word) || word.length > 24) continue
    bump(word, 2)
  }

  // 中文 n-gram：先统计 2–4 字的频次。
  const grams = new Map()
  for (const run of str.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i + n <= run.length; i += 1) {
        const chunk = run.slice(i, i + n)
        let bad = false
        for (const ch of chunk) {
          if (HAN_STOP.has(ch)) {
            bad = true
            break
          }
        }
        if (bad) continue
        grams.set(chunk, (grams.get(chunk) ?? 0) + 1)
      }
    }
  }
  const frequent = [...grams.entries()].filter(([, count]) => count >= 2)
  // 有重复出现的片段时，才做「长的顶掉半截」；一句话里只出现一次的词，
  // 退回 bigram 池，别让「可爱捏」把「可爱」挤掉。
  const kept = frequent.length === 0
    ? [...grams.entries()].filter(([word]) => word.length === 2)
    : frequent.filter(([word, count]) => {
        for (const [other, otherCount] of frequent) {
          if (other.length <= word.length) continue
          if (other.includes(word) && otherCount >= count) return false
        }
        return true
      })
  for (const [word, count] of kept) bump(word, count * (word.length >= 3 ? 2 : 1))

  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, Math.max(0, max))
    .map(([word]) => word)
}

/**
 * 一块的关键词：你说的原话权重更高，收尾和工具名也算。
 * @param block - assignBlocks 的块。
 * @param max - 最多几个。
 * @returns 关键词数组。
 */
// 2026-11-22 为什么：同一块在一次投影里会被分档、提档、报告反复问到，
// 而 extractKeywords 的「长词顶掉半截」是 O(F²)；不缓存就是重复算。
// 用 WeakMap 挂在块对象上，块被回收时缓存一起走，不会攒。
const KEYWORD_CACHE = new WeakMap()

export function blockKeywords(block, max = 6) {
  // 投影里同一块会被反复问（分档、提档、报告），算一次就够
  let cache = KEYWORD_CACHE.get(block)
  if (cache === undefined) {
    cache = new Map()
    KEYWORD_CACHE.set(block, cache)
  }
  const hit = cache.get(max)
  if (hit !== undefined) return hit
  const out = blockKeywordsUncached(block, max)
  cache.set(max, out)
  return out
}

function blockKeywordsUncached(block, max = 6) {
  const counts = new Map()
  const add = (words, weight) => {
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + weight)
  }
  // 你的原话是这块的「题目」，权重最高；收尾和工具名补上下文。
  add(extractKeywords(String(block.title ?? ''), 8), 5)
  add(extractKeywords((block.quotes ?? []).join(' '), 12), 3)
  add(extractKeywords(String(block.ending ?? ''), 8), 1)
  for (const tool of block.tools ?? []) {
    const word = String(tool).toLowerCase()
    if (word !== '') counts.set(word, (counts.get(word) ?? 0) + 2)
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, Math.max(0, max))
    .map(([word]) => word)
}

/** 这一块算不算「有产出」：动过工具或写过文件。 */
export function isWorkBlock(block) {
  return Array.isArray(block.tools) && block.tools.length > 0
}

/**
 * 分档：越近越细。返回 0 = 原文、1 = 事实行、2 = 关键词。
 * 有产出的块提一档（远块也能留事实行）。
 * 和「最近在干的事」沾边的远块也提一档——分档只看时间，会把正在用的旧材料折掉。
 * @param index - 块下标（0 最旧）。
 * @param total - 块总数。
 * @param nearBlocks - 最近几块保原文。
 * @param block - 块（可省）。
 * @param queryWords - 当前话题的词（可省）。
 * @returns 档位。
 */
export function tierOf(index, total, nearBlocks, block, queryWords) {
  const distance = total - 1 - index
  if (distance < nearBlocks) return 0
  const rest = Math.max(1, total - nearBlocks)
  const rank = (distance - nearBlocks) / rest
  let tier = rank < 0.5 ? 1 : 2
  if (tier === 2 && block !== undefined && isWorkBlock(block)) tier = 1
  if (tier === 2 && block !== undefined) tier = relatedTier(block, queryWords)
  return tier
}

/** 与当前话题至少重叠几个词才算「正在用」。 */
const RELATED_HITS = 2

/**
 * 这一块为什么落在现在这一档。给人看的，报告里用。
 * @param index - 块下标。
 * @param total - 块总数。
 * @param nearBlocks - 最近几块保原文。
 * @param block - 块。
 * @param queryWords - 当前话题的词。
 * @returns `'near' | 'work' | 'related' | 'time'`。
 */
export function explainTier(index, total, nearBlocks, block, queryWords) {
  const distance = total - 1 - index
  if (distance < nearBlocks) return 'near'
  if (block !== undefined && isWorkBlock(block)) return 'work'
  if (relatedTier(block, queryWords) === 1) return 'related'
  return 'time'
}

/**
 * 相关性提一档：块的关键词和当前话题重合到阈值，就从关键词行升到事实行。
 * @param block - 块。
 * @param queryWords - 当前话题的词。
 * @returns 1 或 2。
 */
function relatedTier(block, queryWords) {
  if (!Array.isArray(queryWords) || queryWords.length === 0) return 2
  const words = new Set(blockKeywords(block, 10))
  let hit = 0
  for (const word of queryWords) {
    if (words.has(word)) hit += 1
    if (hit >= RELATED_HITS) return 1
  }
  return 2
}

/**
 * 摘要里必须逐字留下的东西（KEEP 清单）：路径、精确报错、数值与单位、带理由的决策。
 * 一行事实塞不下全文，但这些碎片一旦丢了，就得整段翻回来。
 * @param block - 块。
 * @param max - 最多几条。
 * @returns 片段数组。
 */
export function keepSpans(block, max = 2) {
  const source = [String(block?.ending ?? ''), ...(block?.quotes ?? []).map((quote) => String(quote ?? ''))].join('\n')
  if (source === '') return []
  const patterns = [
    /[A-Za-z]:\\[^\s，。；、」）)]{3,}/,
    /(?:\/[\w.-]+){2,}\/?/,
    /\b(?:error|failed|exception)\b[^\n]{0,28}/i,
    /\d+(?:\.\d+)?\s*(?:rpm|°C|ms|tokens?|MB|GB|%|转)/i,
    /(?:因为|所以|原因是|避免)[^\n。；]{2,28}/,
  ]
  const out = []
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (match === null) continue
    const span = String(match[0]).trim().replace(/\s+/g, ' ')
    if (span.length < 4 || out.includes(span)) continue
    out.push(span.length > 32 ? `${span.slice(0, 31)}…` : span)
    if (out.length >= max) break
  }
  return out
}

/** 中段一行事实。 */
/**
 * 硬信息标记：这个块里有没有「翻回去才说得准」的东西。
 *
 * 只认四类，规则尽量窄，宁可漏也别误报：带单位的数字、盘符或深路径、
 * 常见命令、错误码。标记只有一个字，塞进报告，不进上下文。
 * @param block - 块。
 * @returns 标记数组，可能为空。
 */
export function hardMarks(block) {
  const text = String(block?.text ?? '')
  if (text === '') return []
  const marks = []
  if (/\d+(?:\.\d+)?\s*(?:%|ms|秒|分钟|度|°|转|rpm|tokens?|MB|GB|KB|KB\/s)/i.test(text)) marks.push('数')
  if (/[A-Za-z]:\\|\/(?:[\w.-]+\/){2,}/.test(text)) marks.push('路')
  if (/\b(?:npm|pnpm|node|git|pwsh|powershell|robocopy|curl|wget|python)\b/i.test(text)) marks.push('令')
  if (/\b(?:ERR_[A-Z_]+|E[A-Z]{3,}|0x[0-9a-f]{2,})\b/i.test(text)) marks.push('错')
  return marks
}

export function factLine(block, options = {}) {
  const time = stamp(block.time)
  const head = time === '' ? `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}]` : `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1} · ${time}]`
  const parts = [head]
  if (String(block.title ?? '') !== '') parts.push(`「${block.title}」`)
  const tools = Array.isArray(block.tools) ? block.tools.filter((t) => String(t ?? '') !== '') : []
  if (tools.length > 0) parts.push(`动过 ${tools.join('/')}`)
  const notes = Array.isArray(block.notes) ? block.notes.filter((note) => String(note ?? '') !== '').slice(-2) : []
  if (notes.length > 0) parts.push(`结果 ${notes.join(' · ')}`)
  const keep = keepSpans(block)
  if (keep.length > 0) parts.push(`留「${keep.join('｜')}」`)
  if (options.withEnding !== false && String(block.ending ?? '') !== '') parts.push(`收尾「${block.ending}」`)
  parts.push('原文按 seq 取回')
  return parts.join(' · ')
}

/** 块里有没有能写成一行事实的东西（标题、动过的工具、结果、保留片段、收尾）。 */
export function hasFactContent(block) {
  if (String(block?.title ?? '') !== '') return true
  if (Array.isArray(block?.tools) && block.tools.some((t) => String(t ?? '') !== '')) return true
  if (Array.isArray(block?.notes) && block.notes.some((n) => String(n ?? '') !== '')) return true
  if (String(block?.ending ?? '') !== '') return true
  return keepSpans(block).length > 0
}

/** 远段一行：只有关键词 + 指针。 */
export function keywordLine(block, words) {
  const time = stamp(block.time)
  const head = time === '' ? `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}]` : `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1} · ${time}]`
  return `${head} 词：${words.join(' ')}`
}

/** 近段占 target 的上限：二分的判据。原为写死的 0.95，近段吃掉 95%，
 *  索引 + 中段 + 远段只剩约 5%（约 3.4k token），远段一超就整段消失。 */
/** 远段逐条装的硬上限（占 target）：不设上限时远块多会把近段吃穿。 */
export const DEFAULT_FAR_SHARE = 0.15
/** 中段事实行默认 token 上限（0.4.21 实测：60 时原文块 46→69，取回率不变）。 */
export const DEFAULT_FACT_CAP = 60
/** 远段关键词行默认 token 上限（同上实测）。 */
export const DEFAULT_KEYWORD_CAP = 24

/** 关键词行的最小宽度（字符）：剩余空间比它还小就干脆不装远段。
 *  设计稿写的是 60，实测我们这条行只有 35 字符上下（`[块 seq 100-139] 词：…`），
 *  按 60 会永远装不进去，等于没改。取 20：容得下一行，又能挡掉只剩几个字符的空档。 */
export const MIN_FAR_LINE = 20

/** 分卷门槛：会话事件到这个量，取回会明显变慢（见记忆页 projects/jiyu-limits.md）。 */
export const SESSION_EVENT_LIMIT = 100000
/** 提前预警的线：过半就开始提醒，留出准备时间。 */
export const SESSION_WARN_AT = 60000

/**
 * 会话事件到线时的提示行。
 * 2026-11-24 为什么要有：体积没有天花板，真正的墙是会话日志的解析与内存；
 * 但这个信号不会自己冒出来，只能让每次压缩顺手看一眼 seqTo。
 * @param maxSeq - 当前会话最大的 seq。
 * @returns 一行提示，没到线返回空串（平时零占用）。
 */
export function sessionAlert(maxSeq) {
  const n = Number(maxSeq ?? 0)
  if (!Number.isFinite(n) || n < SESSION_WARN_AT) return ''
  const left = Math.max(0, SESSION_EVENT_LIMIT - n)
  return `[注意] 会话事件已到 ${n} 条，距分卷门槛 ${SESSION_EVENT_LIMIT} 还差 ${left}；取回会随日志变慢，该准备分卷 + 目录（见记忆页 projects/jiyu-limits.md）`
}

/**
 * 未知块类型的提醒行：白名单会把这些块挡在上下文外，必须让它可见。
 * 没遇到未知类型返回空串，平时零占用。
 * @param types - Map<类型, 字符数>。
 * @returns 一行提示，或空串。
 */
export function unknownAlert(types) {
  if (types === null || types === undefined || typeof types.size !== 'number' || types.size === 0) return ''
  const list = [...types].map(([type, chars]) => `${type} ${chars} 字`).join('、')
  return `\n[压缩告警] 未知块类型未纳入上下文：${list}。原文要按 seq 用会话日志核对（取回工具只认正文块），先确认它是不是新格式。`
}

/**
 * 把旧检查点条目折成指针行——这一步消掉雪球：上一次压缩的正文不再被原样重复。
 * @param entries - `{ seq, text, kind }[]`。
 * @returns 新数组。
 */
export function pointerize(entries) {
  return entries.map((entry) =>
    entry.kind === 'checkpoint'
      ? {
          seq: entry.seq,
          text: `${BLOCK_HEAD} seq ${entry.seq}] 更早的检查点，正文已折成指针，原文按 seq ${entry.seq} 取回`,
          kind: 'text',
        }
      : entry,
  )
}


/**
 * 把一行裁到 token 上限以内（按 estimate 自己的刻度二分，不猜字符比）。
 * 2026-11-26：这是「单行成本封顶」的实现——中段事实行、远段关键词行各自限长，
 * 省下来的预算按同一条二分自动还给近段原文（keep 会自然变大）。
 * 只裁「新生成」的行；已冻结的行（上一次投影留下的）绝不重裁，否则前缀会漂。
 * @param text - 行文本。
 * @param cap - token 上限；<=0 表示不裁。
 * @param estimate - 估算函数。
 * @returns 裁剪后的文本。
 */
function capLine(text, cap, estimate) {
  if (!(cap > 0)) return text
  const source = String(text ?? '')
  if (estimate(source) <= cap) return source
  let lo = 0
  let hi = source.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (estimate(source.slice(0, mid)) <= cap - 1) lo = mid
    else hi = mid - 1
  }
  return `${source.slice(0, Math.max(0, lo - 1))}…`
}

/**
 * 主投影函数。
 * @param input - `entries`（编译器输出）、`blocks`、`targetTokens`、`estimate`、`nearBlocks`、`engine`。
 * @returns `{ entries, stats }`。
 */
export function projectRegion(input) {
  const entries = pointerize(Array.isArray(input.entries) ? input.entries : [])
  const blocks = Array.isArray(input.blocks) ? input.blocks : []
  const estimate = input.estimate ?? ((text) => String(text ?? '').length)
  const targetTokens = Math.max(0, Number(input.targetTokens ?? 0))
  const nearBlocks = Math.max(1, Number(input.nearBlocks ?? 3))
  const farWords = Math.max(1, Number(input.farWords ?? 6))
  // 近段上限与远段上限都可配；越界时夹到 0.1–1，宁可不生效也不要算出怪比例。
  const clampShare = (value, fallback) => {
    const n = Number(value ?? fallback)
    if (!Number.isFinite(n)) return fallback
    return Math.min(1, Math.max(0.1, n))
  }
  const farShare = clampShare(input.farShare, DEFAULT_FAR_SHARE)
  // 单行成本封顶（0 = 不裁）。中段事实行、远段关键词行各自限长。
  const factCap = Math.max(0, Number(input.factCap ?? 0))
  const keywordCap = Math.max(0, Number(input.keywordCap ?? 0))

  if (blocks.length === 0) {
    const tokens = entries.reduce((sum, entry) => sum + estimate(entry.text), 0)
    return { entries, stats: { tokens, near: entries.length, mid: 0, far: 0, blocks: 0, indexWords: 0 } }
  }

  // 条目按块分桶；落在块外的（比如检查点指针）留到 near 桶尾部。
  const buckets = blocks.map(() => [])
  const loose = []
  for (const entry of entries) {
    const seq = Number(entry.seq)
    let placed = false
    for (let i = 0; i < blocks.length; i += 1) {
      if (seq >= blocks[i].startSeq && seq < blocks[i].endSeq) {
        buckets[i].push(entry)
        placed = true
        break
      }
    }
    if (!placed) loose.push(entry)
  }

  // 上一次投影留下的块行：同一块的文字逐字节沿用，不重写。
  // append-only 的关键——已进过窗口的块一旦重写，前缀缓存作废，早期内容也跟着漂。
  const frozen = new Map()
  for (const entry of entries) {
    const match = /\[块 seq (\d+)-(\d+)/.exec(String(entry?.text ?? ''))
    if (match === null) continue
    frozen.set(Number(match[1]), { end: Number(match[2]), text: String(entry.text) })
  }
  const frozenLine = (block, fallback) => {
    const hit = frozen.get(Number(block.startSeq))
    if (hit !== undefined && hit.end === Number(block.endSeq) - 1) return hit.text
    return fallback
  }
  /** 新行才裁；冻结行原样返回（裁了就等于改写已进过窗口的内容）。 */
  const cappedLine = (block, fallback, cap) => {
    const hit = frozen.get(Number(block.startSeq))
    if (hit !== undefined && hit.end === Number(block.endSeq) - 1) return hit.text
    return capLine(fallback, cap, estimate)
  }

  /**
   * 按「最近 keep 块保原文」投一次。
   * @param keep - 最近几块保原文。
   * @returns `{ entries, stats }`。
   */
  const build = (keep) => {
    const nearStart = Math.max(0, blocks.length - keep)
    const nearEntries = []
    for (let i = nearStart; i < blocks.length; i += 1) nearEntries.push(...buckets[i])
    nearEntries.push(...loose)

    // 当前话题：拿最近几块的关键词当「正在干的事」，远处的块据此提档。
    const queryWords = [...new Set(blocks.slice(nearStart).flatMap((block) => blockKeywords(block, 10)))].slice(0, 24)

    const midItems = []
    const farItems = []
    const keywordIndex = new Map()
    const tiers = []
    for (let i = 0; i < nearStart; i += 1) {
      const block = blocks[i]
      const tier = tierOf(i, blocks.length, keep, block, queryWords)
      // 2026-11-27 修：报告里 summary 数的是「真发出去的行」（mid/far），
      // blocks 原来记的是「计划给哪档」，两处口径不同——实测那次 summary 写
      // 42 事实 / 39 关键词，blocks 却是 41/40，差的那块是计划给指针、渲染
      // 时提不出词改留事实行。现在按落地的那一档记，两处从同一个账本出。
      let placed = tier
      if (tier === 1) {
        midItems.push({ seq: block.startSeq, text: cappedLine(block, factLine(block, { withEnding: true }), factCap) })
        tiers.push({
          start: block.startSeq,
          end: block.endSeq - 1,
          tier: placed,
          reason: explainTier(i, blocks.length, keep, block, queryWords),
          marks: hardMarks(block),
        })
        continue
      }
      const words = blockKeywords(block, farWords)
      if (words.length === 0) {
        // 提不出词（块太短、整块都是工具输出）：别留空壳，退一步留事实行，
        // 至少写清标题、动过什么、收尾说了什么；实在什么都没有才只留指针。
        const text = hasFactContent(block)
          ? factLine(block, { withEnding: true })
          : `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}] 原文按 seq 取回`
        midItems.push({ seq: block.startSeq, text: cappedLine(block, text, factCap) })
        placed = 1
        tiers.push({
          start: block.startSeq,
          end: block.endSeq - 1,
          tier: placed,
          reason: explainTier(i, blocks.length, keep, block, queryWords),
          marks: hardMarks(block),
        })
        continue
      }
      // 逐条装用的优先级：work*10 + related（硬的当主序，软的当次序）。
      // 与 tierOf 不同，这里不升档、只排序——升档会让中段变大，改动面太大。
      const related = relatedTier(block, queryWords) === 1 ? 1 : 0
      const work = isWorkBlock(block) ? 1 : 0
      farItems.push({ seq: block.startSeq, text: cappedLine(block, keywordLine(block, words), keywordCap), priority: work * 10 + related })
      placed = 2
      tiers.push({
        start: block.startSeq,
        end: block.endSeq - 1,
        tier: placed,
        reason: explainTier(i, blocks.length, keep, block, queryWords),
        marks: hardMarks(block),
      })
      for (const word of words) {
        const list = keywordIndex.get(word) ?? []
        list.push([block.startSeq, block.endSeq - 1])
        keywordIndex.set(word, list)
      }
    }

    const estimateAll = (list) => list.reduce((sum, entry) => sum + estimate(entry.text), 0)
    const nearTokens = estimateAll(nearEntries)
    const midTokens = estimateAll(midItems)
    const farTokens = estimateAll(farItems)
    const indexLine = buildIndexLine(keywordIndex)
    const indexTokens = indexLine === null ? 0 : estimate(indexLine.text)

    let out = []
    if (targetTokens <= 0 || nearTokens + midTokens + farTokens + indexTokens <= targetTokens) {
      out = [...midItems, ...farItems, ...nearEntries]
      if (indexLine !== null) out.push(indexLine)
    } else if (nearTokens + midTokens + indexTokens <= targetTokens) {
      // 2026-11-25 为什么改：以前这里是「远段整份装不下就整段丢」，超 20 字符和超 2 万
      // 一样归零。实测那次 target 68,812、压完 64,504，箱子还空 4.3k，远段 15 条只要
      // 约 1.4k——多超一点就全没了。现在按剩余空间逐条装，装不下就停（不跳着装，
      // 否则关键词行在时间轴上留空洞，取回时判不清边界）。
      const ordered = [...farItems].sort(
        (a, b) => (Number(b.priority ?? 0) - Number(a.priority ?? 0)) || Number(b.seq) - Number(a.seq),
      )
      // 硬上限：远块特别多时逐条装会把近段吃穿，所以最多吃到 target × farShare。
      const farBudget = Math.min(Math.floor(targetTokens * farShare), targetTokens - midTokens - indexTokens)
      const picked = []
      let used = 0
      if (farBudget >= MIN_FAR_LINE) {
        for (const item of ordered) {
          const cost = estimate(item.text)
          if (used + cost > farBudget) break
          picked.push(item)
          used += cost
        }
      }
      out = [...midItems, ...picked, ...nearEntries]
      if (indexLine !== null) out.push(indexLine)
    } else if (nearTokens + midTokens <= targetTokens) {
      // 中段也超：丢索引，中段保留事实行。
      out = [...midItems, ...nearEntries]
    } else {
      // 近段自己就超：只留近段，交给 vcc 的 cap 裁剪。
      out = [...nearEntries]
    }

    const nearSet = new Set(nearEntries)
    const midSet = new Set(midItems)
    const farSet = new Set(farItems)

    /** 每块的最小落脚点（一行 `原文按 seq 取回` 指针）。 */
    const pointerOf = (block) =>
      frozenLine(block, `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}] 原文按 seq 取回`)

    /**
     * 当前这批行还盖住了哪些块；没盖住的块要补指针。
     *
     * 2026-11-27：一开始写成「每轮重扫全部条目 × 全部块」，2000 块的真实规模下
     * 是 O(条目 × 块)、还要在裁的每一轮重跑——投影跑在 agent/pre-step 里，是同步的，
     * 这条必须一次算好再增量维护。现在按 seq 二分一次，之后每丢一条只减它所属块的计数。
     */
    const blockIndexFor = (seq) => {
      let lo = 0
      let hi = blocks.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const block = blocks[mid]
        if (seq < Number(block.startSeq)) hi = mid - 1
        else if (seq >= Number(block.endSeq)) lo = mid + 1
        else return mid
      }
      return -1
    }
    const hitCount = new Array(blocks.length).fill(0)
    for (const entry of out) {
      const index = blockIndexFor(Number(entry.seq))
      if (index >= 0) hitCount[index] += 1
    }
    const pads = []
    let padTokens = 0
    const syncPads = () => {
      for (let i = 0; i < blocks.length; i += 1) {
        if (hitCount[i] > 0) continue
        if (pads[i] !== undefined) continue
        pads[i] = { seq: blocks[i].startSeq, text: pointerOf(blocks[i]) }
        padTokens += estimate(pads[i].text)
      }
    }
    syncPads()
    let outTokens = estimateAll(out)
    while (targetTokens > 0 && outTokens + padTokens > targetTokens) {
      // 让的顺序按引擎分：
      //   time（二分）沿用老行为，先牺牲近段原文——它的分支已先装好中/远段；
      //   plan 的设计是「原文优先」，块多时如果先让近段，就退化成一条原文都不留
      //   （审查 B1 的实质）。所以 plan 先让远段、再让事实行，最后才动原文。
      // 只剩 plan 一条路：先让远段、再让事实行，最后才动原文。
      const victim = out.find((entry) => farSet.has(entry)) ??
        out.find((entry) => midSet.has(entry)) ??
        out.find((entry) => nearSet.has(entry))
      if (victim === undefined) break
      out = out.filter((entry) => entry !== victim)
      outTokens -= estimate(victim.text)
      const index = blockIndexFor(Number(victim.seq))
      if (index >= 0) {
        hitCount[index] -= 1
        if (hitCount[index] === 0 && pads[index] === undefined) {
          pads[index] = { seq: blocks[index].startSeq, text: pointerOf(blocks[index]) }
          padTokens += estimate(pads[index].text)
        }
      }
    }
    out.push(...pads.filter((pad) => pad !== undefined))
    // 报告口径：tiers 原来记的是「计划给哪一档」，裁剪/补指针之后会和真发出去的行
    // 不一致（审查 B3：summary 写 mid 0/far 0，报告 117 块全标成事实行）。
    // 现在按最终 out 里真实存在的那一行重新定档：词行=2、事实行=1、只剩指针=0。
    const bySeq = new Map()
    for (const entry of out) {
      const seq = Number(entry.seq)
      if (!bySeq.has(seq)) bySeq.set(seq, [])
      bySeq.get(seq).push(String(entry.text ?? ''))
    }
    for (const tier of tiers) {
      const texts = bySeq.get(Number(tier.start)) ?? []
      if (texts.some((text) => text.includes('] 词：'))) tier.tier = 2
      else if (texts.some((text) => text.startsWith(BLOCK_HEAD))) tier.tier = 1
      else tier.tier = 0
    }

    out.sort((a, b) => Number(a.seq) - Number(b.seq))
    const tokens = estimateAll(out)
    // 2026-11-27：keep 以前报的是「请求保留几块」，预算裁剪之后可能比实际多。
    // 现在报真实值：近段里还有行落在它区间内的块才算保住了。
    // 2026-11-27 修（审查 B5）：指针也算「有行落在区间里」，于是只剩指针的块被报成
    // 保住了原文（实测 keep=10、实际原文条目 1）。现在只认原文条目。
    const rawSeqs = [...new Set(out.filter((entry) => nearSet.has(entry)).map((entry) => Number(entry.seq)))]
    let keptBlocks = 0
    for (let i = Math.max(0, blocks.length - keep); i < blocks.length; i += 1) {
      const block = blocks[i]
      if (rawSeqs.some((seq) => seq >= Number(block.startSeq) && seq < Number(block.endSeq))) keptBlocks += 1
    }
    return {
      entries: out,
      stats: {
        tokens,
        // 数的是真发出去的行，不是「算出来的」——否则报告会骗人
        near: out.filter((entry) => nearSet.has(entry)).length,
        mid: out.filter((entry) => midSet.has(entry)).length,
        far: out.filter((entry) => farSet.has(entry)).length,
        blocks: blocks.length,
        // 2026-11-27 修（审查 B6）：索引行只印前 INDEX_LIMIT 个词，这里原来报整个
        // keywordIndex.size（实测报 242、行里只有 24 个）。报告要和真发出去的行同口径。
        indexWords: indexLine !== null && out.includes(indexLine) ? Math.min(keywordIndex.size, INDEX_LIMIT) : 0,
        keep: keptBlocks,
        keepRequested: keep,
        // 2026-11-27：打包（裁到目标 + 补指针）之后 tokens 永远 ≤ 目标，
        // 二分若拿它当尺子，就会一路把 keep 抬到最大（实测 keep=23 把远段全挤掉）。
        // demand 是「不裁的话要多少」，二分拿它判断「这一档装不装得下」。
        demand: nearTokens + midTokens + farTokens + indexTokens,
        // 每档实际花掉多少 token：块数会骗人（块碎了原文块就多），字数是真账。
        tierTokens: { raw: nearTokens, fact: midTokens, keyword: farTokens, index: indexTokens },
        tiers: tiers.filter((tier) => out.some((entry) => Number(entry.seq) === Number(tier.start))),
      },
    }
  }

  // 从最小保留区开始，预算还有余就多保一段原文——「近的尽量保全」靠这一步，
  // 而不是写死「最近 3 块」。
  // 2026-11-22 为什么：原来是「从 nearBlocks 一路试到块数」，每试一次都重建一遍
  // 全部块的关键词，263 块的真实会话要 24.6 秒——而投影跑在 agent/pre-step 里，是同步的。
  // 二分之后同一份验收 3.0 秒。
  // 验：node test/acceptance.mjs <263 块会话>，看 real 时间
  // keep 越大、保留的原文越多。二分找「还能塞进预算的最大 keep」，
  // 比从 nearBlocks 一路试到块数少一个量级的构建次数。
  // 2026-11-28：二分已删，plan 是唯一路径。预算为 0 时退回最小保留区，
  // 其余情况用 planProjection 一次算出 keep，再走同一个 build（渲染、冻结、
  // 落脚点、索引复用）。
  if (targetTokens > 0) {
    const costOf = (index, tier) => {
      const block = blocks[index]
      const frozenHit = frozen.get(Number(block.startSeq))
      if (tier === TIER_RAW) return (buckets[index] ?? []).reduce((sum, entry) => sum + estimate(entry.text), 0)
      if (tier === TIER_FACT) return estimate(frozenHit !== undefined ? frozenHit.text : capLine(factLine(block, { withEnding: true }), factCap, estimate))
      const words = blockKeywords(block, farWords)
      // 2026-11-27 修（审查 B1）：TIER_POINTER 这个档在 build 里真的只发一行
      // `原文按 seq 取回`（约 13 token），而这里原来按关键词行（约 37）计价。
      // 垫底价虚高 2.8 倍 → 块一多（实测 2000 块）plan 判定「连垫底都装不下」，
      // 直接 k=0：一条原文都不留，全部退成事实/关键词/指针。
      if (tier === TIER_POINTER) {
        const pointer = frozenHit !== undefined
          ? frozenHit.text
          : `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}] 原文按 seq 取回`
        return estimate(pointer)
      }
      if (frozenHit !== undefined) return estimate(frozenHit.text)
      // 和 build 对齐：提不出词的块会被留成事实行（不是指针），这里必须按事实行算价，
      // 否则规划按便宜的指针价装，渲染出来却贵一截——0.4.24 实测超出目标 1.2% 就是这个。
      if (words.length === 0) {
        const text = hasFactContent(block) ? factLine(block, { withEnding: true }) : `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}] 原文按 seq 取回`
        return estimate(capLine(text, factCap, estimate))
      }
      return estimate(capLine(keywordLine(block, words), keywordCap, estimate))
    }
    const planArgs = {
      blocks,
      target: targetTokens,
      indexCost: 0,
      factShare: Number(input.factShare ?? 0.2),
    }
    // 第一遍：按「指针价」估。第二遍：按第一遍的 keep 推出当前话题，
    // 把会被相关性/工具提档成事实行的块按事实行计价——否则规划以为它便宜。
    const first = planProjection({ ...planArgs, costOf })
    const planWords = [...new Set(blocks.slice(Math.max(0, blocks.length - first.k)).flatMap((block) => blockKeywords(block, 10)))].slice(0, 24)
    const costOfRepriced = (index, tier) => {
      if (tier !== TIER_POINTER) return costOf(index, tier)
      const block = blocks[index]
      if (block === undefined) return 0
      if (tierOf(index, blocks.length, first.k, block, planWords) !== 1) return costOf(index, tier)
      return estimate(capLine(factLine(block, { withEnding: true }), factCap, estimate))
    }
    const plan = planProjection({ ...planArgs, costOf: costOfRepriced })
    // 2026-11-27 修（审查 B1）：重定价那一遍会把「当前话题里会被提档成事实行」的块
    // 按事实行计价，块一多，光垫底就超预算 → 返回 k=0，一条原文都不留。
    // 实测 2000 块：time 留 274 块原文，plan 留 0。回退到第一遍（按真实指针价）算出的 k，
    // 至少保证「原文优先」这条设计没被计价方式吃掉。
    const chosen = plan.k > 0 ? plan : first
    if (process.env.JIYU_DEBUG_PLAN === '1') {
      console.error('[plan]', JSON.stringify({ target: targetTokens, first: first.k, repriced: plan.k, k: chosen.k, tokens: chosen.tokens }))
    }
    return build(chosen.k)
  }

  // 没有预算（target=0）时不做规划，保最小保留区。
  return build(nearBlocks)
}

/**
 * 全局关键词索引：词 → 出现在哪些远块（记区间，最多列 3 段）。
 * @param map - 词到 `[start, end]` 段数组。
 * @param limit - 最多几个词。
 * @returns 一条条目，没词时为 null。
 */
export const INDEX_LIMIT = 24

export function buildIndexLine(map, limit = INDEX_LIMIT) {
  const words = [...map.entries()]
    .sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1))
    .slice(0, limit)
  if (words.length === 0) return null
  const parts = words.map(([word, ranges]) => {
    const shown = ranges.slice(0, 3).map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`))
    return `${word}→${shown.join(',')}`
  })
  return {
    seq: words[0][1][0][0],
    text: `[关键词索引] ${parts.join('; ')}`,
    kind: 'note',
  }
}

/**
 * 解析索引行里的区间：`词→12-30,45; 词2→90`。
 * @param text - 索引行文本。
 * @returns `{ word, ranges: [start, end][] }[]`。
 */
export function parseIndex(text) {
  const out = []
  const body = String(text ?? '').replace(/^\[关键词索引\]\s*/, '')
  for (const part of body.split(';')) {
    const [word, rangesRaw] = part.split('→')
    if (word === undefined || rangesRaw === undefined) continue
    const ranges = []
    for (const chunk of rangesRaw.split(',')) {
      const [a, b] = chunk.split('-')
      const start = Number(a)
      const end = b === undefined ? Number(a) : Number(b)
      if (Number.isFinite(start) && Number.isFinite(end)) ranges.push([start, end])
    }
    out.push({ word: word.trim(), ranges })
  }
  return out
}

/**
 * 取回测试：关键词索引能不能把查询指回某块。
 * @param indexText - 索引行文本。
 * @param query - 查询文本。
 * @param limit - 最多几个查询词。
 * @returns 命中的 `{ word, ranges }[]`。
 */
export function matchIndex(indexText, query, limit = 5) {
  const entries = parseIndex(indexText)
  const hits = []
  for (const word of extractKeywords(query, limit)) {
    const entry = entries.find((item) => item.word === word)
    if (entry !== undefined) hits.push(entry)
  }
  return hits
}
