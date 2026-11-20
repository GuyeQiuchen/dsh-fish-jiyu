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

/** 压成一行：去代码块、去 markdown 记号、收空白。 */
export function short(text, maxChars) {
  const flat = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= maxChars) return flat
  return `${flat.slice(0, Math.max(0, maxChars - 1))}…`
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
export function blockKeywords(block, max = 6) {
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
 * 主投影函数。
 * @param input - `entries`（vcc 编译结果）、`blocks`、`targetTokens`、`estimate`、`nearBlocks`、`midChars`。
 * @returns `{ entries, stats }`。
 */
export function projectRegion(input) {
  const entries = pointerize(Array.isArray(input.entries) ? input.entries : [])
  const blocks = Array.isArray(input.blocks) ? input.blocks : []
  const estimate = input.estimate ?? ((text) => String(text ?? '').length)
  const targetTokens = Math.max(0, Number(input.targetTokens ?? 0))
  const nearBlocks = Math.max(1, Number(input.nearBlocks ?? 3))
  const midMax = Math.max(20, Number(input.midMax ?? 140))
  const farWords = Math.max(1, Number(input.farWords ?? 6))

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
      tiers.push({
        start: block.startSeq,
        end: block.endSeq - 1,
        tier,
        reason: explainTier(i, blocks.length, keep, block, queryWords),
        marks: hardMarks(block),
      })
      if (tier === 1) {
        midItems.push({ seq: block.startSeq, text: frozenLine(block, factLine(block, { withEnding: true })) })
        continue
      }
      const words = blockKeywords(block, farWords)
      if (words.length === 0) {
        // 提不出词（块太短、整块都是工具输出）：别留空壳，退一步留事实行，
        // 至少写清标题、动过什么、收尾说了什么；实在什么都没有才只留指针。
        const text = hasFactContent(block)
          ? factLine(block, { withEnding: true })
          : `${BLOCK_HEAD} seq ${block.startSeq}-${block.endSeq - 1}] 原文按 seq 取回`
        midItems.push({ seq: block.startSeq, text: frozenLine(block, text) })
        continue
      }
      farItems.push({ seq: block.startSeq, text: frozenLine(block, keywordLine(block, words)) })
      for (const word of words) {
        const list = keywordIndex.get(word) ?? []
        list.push([block.startSeq, block.endSeq - 1])
        keywordIndex.set(word, list)
      }
    }

    const nearTokens = nearEntries.reduce((sum, entry) => sum + estimate(entry.text), 0)
    const midTokens = midItems.reduce((sum, entry) => sum + estimate(entry.text), 0)
    const farTokens = farItems.reduce((sum, entry) => sum + estimate(entry.text), 0)
    const indexLine = buildIndexLine(keywordIndex)
    const indexTokens = indexLine === null ? 0 : estimate(indexLine.text)

    let out = []
    if (targetTokens <= 0 || nearTokens + midTokens + farTokens + indexTokens <= targetTokens) {
      out = [...midItems, ...farItems, ...nearEntries]
      if (indexLine !== null) out.push(indexLine)
    } else if (nearTokens + midTokens + indexTokens <= targetTokens) {
      // 远段超预算：只留全局索引，块级关键词行让位。
      out = [...midItems, ...nearEntries]
      if (indexLine !== null) out.push(indexLine)
    } else if (nearTokens + midTokens <= targetTokens) {
      // 中段也超：丢索引，中段保留事实行。
      out = [...midItems, ...nearEntries]
    } else {
      // 近段自己就超：只留近段，交给 vcc 的 cap 裁剪。
      out = [...nearEntries]
    }

    out.sort((a, b) => Number(a.seq) - Number(b.seq))
    const tokens = out.reduce((sum, entry) => sum + estimate(entry.text), 0)
    return {
      entries: out,
      stats: {
        tokens,
        near: nearEntries.length,
        mid: midItems.length,
        far: farItems.length,
        blocks: blocks.length,
        indexWords: keywordIndex.size,
        keep,
        tiers,
      },
    }
  }

  // 从最小保留区开始，预算还有余就多保一段原文——「近的尽量保全」靠这一步，
  // 而不是写死「最近 3 块」。
  let best = build(nearBlocks)
  if (targetTokens > 0) {
    for (let keep = nearBlocks + 1; keep <= blocks.length; keep += 1) {
      const attempt = build(keep)
      if (attempt.stats.tokens > targetTokens * 0.95) break
      best = attempt
    }
  }
  return best
}

/**
 * 全局关键词索引：词 → 出现在哪些远块（记区间，最多列 3 段）。
 * @param map - 词到 `[start, end]` 段数组。
 * @param limit - 最多几个词。
 * @returns 一条条目，没词时为 null。
 */
export function buildIndexLine(map, limit = 24) {
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
