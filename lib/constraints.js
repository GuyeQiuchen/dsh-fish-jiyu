/**
 * 约束区：把用户明确说过的「还必须遵守什么」单独留一块，不参与折叠。
 *
 * 为什么单独一块：中段事实行记的是事件（过去式），会继续折成关键词；
 * 约束要的是祈使句短清单，折一次就废。所以它固定渲染在检查点最前，
 * 每行带 seq，原文仍按 seq 取回。
 *
 * 取舍：宁可漏抽，不可抽错。抽错的约束会被当明文规则执行，比没有更糟。
 * 所以只认显式祈使句（不要/必须/改成/最多…），问句、举例、假设一律跳过。
 */

/** 每块最多几行；超过按优先级丢。 */
export const MAX_CONSTRAINT_ROWS = 8
/** 约束区总字符上限（≈350 token）。 */
export const MAX_CONSTRAINT_CHARS = 480
/** 单行文本上限，超了截断。 */
export const MAX_ROW_CHARS = 60
/** 标题行固定，保证继承时逐字节稳定。 */
const HEAD = '[约束 · 仍然有效]'

const KIND_ORDER = { forbid: 3, param: 2, require: 2, goal: 1 }
const KIND_LABEL = { forbid: '禁止', param: '参数', require: '必须', goal: '目标' }

const SENTENCE_SPLIT = /(?<=[\n。！？!?；;])/

/** 问句、举例、假设、转述一律不抽。 */
const SKIP_IF = [
  /[?？]\s*$/,
  /(吗|么|呢)\s*$/,
  /^(为什么|为什么说|怎么|如何|多久|多少|几个|哪种|哪个|谁)/,
  /(会不会|能不能|是不是|行不行|对不对|有没有|要不要).*[?？]?$/,
  /(有什么办法|怎么办|行吗|可以吗|好不好)/,
  /^你(能|可以|会|帮).*(吗|呢)/,
  /^(比如|例如|假设|假如|比喻|顺便问|我想问)/,
  /(是不是|要不要|能不能|可不可以)(?!.*(必须|不要|禁止))/,
  /^(注|备注|说明)[：:]/,
  /^(我|你|他|她)(觉得|认为|猜|估计)/,
]

/**
 * 一次性派活：句子里有「评估一下/看一下/查一下…」这类动作。
 * 它们是在派当天的活，不是长期规矩；压进约束区会误报「被压丢了」。
 */
const ONE_OFF = /(评估|分析一下|检查一下|看一下|看看|查一下|查查|查一查|试一下|试试|跑一下|测一下|测测|总结一下|整理一下|对比一下|优化一下)/

/** 句子里带这些，就还是规矩，不能按一次性派活跳过。 */
const KEEP_MARK = /(不要|(?<![级分特个类性])别|必须|禁止|不准|不许|最多|至少|改成|改为|改完|修完|做完|写完|改好|弄完|测完|验完|务必要)/

/** 明确祈使/要求。 */
const PATTERNS = [
  {
    kind: 'forbid',
    re: /(不要|(?<![级分特个类性])别|禁止|不准|不许|不可以|切勿|勿)\s*[^\s，。]{0,6}(做|动|改|删|加|发|写|碰|用|装|跑|提交|推|开|关|暴露|上传|分享|说|提)/,
  },
  { kind: 'forbid', re: /(不要|(?<![级分特个类性])别|禁止|不准|不许|切勿)\s*[^\s，。]{2,24}$/ },
  { kind: 'param', re: /(最多|至少|不超过|上限|下限|改成|改为|调成|设为|限制为|限速|默认|只[能准]|冷却|以内|之内)\s*[^，。]{0,14}\d/ },
  { kind: 'param', re: /\d[^，。]{0,14}(冷却|限速|上限|以内|之内|(?<!轮)次)/ },
  { kind: 'require', re: /(必须|务必|一定要|记得|别忘了|要先|先[^，。]{1,12}(再|然后)|做完[^，。]{0,12}再)/ },
  { kind: 'require', re: /(改完|修完|做完|写完|改好|弄完)[^。]{0,12}(要|再|就|得|必须|然后)[^。]{1,14}(测试|测|装|评估|封包|重启|验证|跑|发)/ },
  { kind: 'require', re: /(能装|可以|没问题|通过)[^。]{0,6}(就|再)[^。]{1,12}(装|测|封包|发|提交|重启)/ },
  { kind: 'require', re: /(改完|修完|做完|写完|改好|弄完|测完|验完)[^。]{0,10}(测试|测|验证|评估|封包|装|重启)/ },
  { kind: 'require', re: /^(别|不要|记得|下次)[^。]{2,40}$/ },
  { kind: 'require', re: /(要|得|必须|留)[^。]{0,10}(备份|回退|回滚)/ },
  { kind: 'goal', re: /^(先把|先做|先只做|目标是|这轮先|下一步要)/ },
]

/**
 * 去掉用于比较的标点与空白。
 * @param text - 原文。
 * @returns 归一化文本。
 */
function norm(text) {
  return String(text ?? '').replace(/[\s，。、；：！？"'“”‘’（）()·]/g, '')
}

/**
 * 字面相似度（二元组重合），用于判断「同一件事换了说法」。
 * @param a - 文本 a。
 * @param b - 文本 b。
 * @returns 0–1。
 */
function overlap(a, b) {
  const bigrams = (s) => {
    const out = new Set()
    for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2))
    return out
  }
  const A = bigrams(norm(a))
  const B = bigrams(norm(b))
  if (A.size === 0 || B.size === 0) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit += 1
  return hit / Math.max(A.size, B.size)
}

/**
 * 一条句子能不能当约束；能就返回分类。
 * @param sentence - 单句。
 * @returns 类型名或空串。
 */
export function classifySentence(sentence) {
  const text = String(sentence ?? '').trim()
  if (text.length < 4 || text.length > 90) return ''
  // 一次性派活先排除：有动作、但没有「不要/必须/改成…」这类规矩标记。
  if (ONE_OFF.test(text) && !KEEP_MARK.test(text)) return ''
  for (const rule of SKIP_IF) if (rule.test(text)) return ''
  for (const rule of PATTERNS) if (rule.re.test(text)) return rule.kind
  return ''
}

/**
 * 从一段用户原话里抽约束句。
 * @param text - 用户消息正文。
 * @returns `{ kind, text }[]`。
 */
export function extractFromText(text) {
  const out = []
  for (const raw of String(text ?? '').split(SENTENCE_SPLIT)) {
    const sentence = raw.trim().replace(/^[-*·\d.、\s]+/, '').trim()
    const kind = classifySentence(sentence)
    if (kind === '') continue
    const clipped = sentence.length > MAX_ROW_CHARS ? `${sentence.slice(0, MAX_ROW_CHARS - 1)}…` : sentence
    out.push({ kind, text: clipped })
  }
  return out
}

/**
 * 解析上一次检查点里的约束区。
 * @param text - 检查点正文。
 * @returns 行数组。
 */
export function parseConstraints(text) {
  const rows = []
  let inSection = false
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[约束')) {
      inSection = true
      continue
    }
    if (!inSection) continue
    if (trimmed === '') continue
    if (!trimmed.startsWith('- ')) break
    const match = /^- \[(禁止|必须|参数|目标)\]\s*(.+?)(?:（seq (\d+)）)?$/.exec(trimmed)
    if (match === null) continue
    const kind = Object.keys(KIND_LABEL).find((key) => KIND_LABEL[key] === match[1]) ?? 'require'
    const body = match[2].replace(/（原 seq \d+ 已被 seq \d+ 改）$/, '')
    rows.push({ kind, text: body, seq: Number(match[3] ?? 0) })
  }
  return rows
}

/** 检查点节点识别：只有带 seq 覆盖的 user 侧编译产物才可能含约束区。 */
export function isCheckpointText(text) {
  return String(text ?? '').includes('[约束') || String(text ?? '').includes('Compiled checkpoint')
}

/**
 * 兼容编译器的节点形状：`{ seq, message }` 里的 message 可能是
 * `{ role, content }`，content 是字符串或带 text 的块数组。
 * 2026-11-23 为什么加：真实路径递进来的就是这种形状，只认 `text` 会让抽取恒为 0。
 * @param message - 消息对象。
 * @returns 纯文本，取不到就是空串。
 */
function textOfMessage(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (typeof block.text !== 'string') continue
    // 白名单：约束只从「真说出口的正文块」里抽；草稿和未知类型都不算。
    if (String(block.type ?? '') !== 'text') continue
    parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 从待压节点里收集：继承旧约束 + 抽取新约束，合并去重。
 * @param nodes - `{ seq, role, text }[]`。
 * @param opts - `{ maxRows, maxChars }`。
 * @returns `{ rows, newRows, carried }`。
 */
export function collectConstraints(nodes, opts = {}) {
  const maxRows = Math.max(1, Number(opts.maxRows ?? MAX_CONSTRAINT_ROWS))
  const maxChars = Math.max(80, Number(opts.maxChars ?? MAX_CONSTRAINT_CHARS))
  const carried = []
  const fresh = []
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const seq = Number(node?.seq ?? 0)
    const text = String(node?.text ?? textOfMessage(node?.message))
    const role = String(node?.role ?? node?.message?.role ?? '')
    if (text === '') continue
    // 2026-11-23 为什么先判检查点：检查点本身可能挂在 user 角色上，
    // 先走「抽取」就会从旧检查点正文里挖出祈使句（「别再打补丁了」这种），
    // 当成新约束继承下去——越压越脏。检查点只认它自己的「约束」段。
    if (isCheckpointText(text)) {
      for (const row of parseConstraints(text)) carried.push(row)
      continue
    }
    if (role === 'user') {
      for (const row of extractFromText(text)) fresh.push({ ...row, seq })
    }
  }
  return { rows: mergeConstraints(carried, fresh, { maxRows, maxChars }), carried: carried.length, fresh: fresh.length }
}

/**
 * 合并新旧约束：同一件事用新说法覆盖旧说法，并留下「改过」的痕迹。
 * @param oldRows - 继承的旧行。
 * @param newRows - 本次新抽的行。
 * @param opts - 上限。
 * @returns 合并后的行（按重要度、再由旧到新）。
 */
export function mergeConstraints(oldRows, newRows, opts = {}) {
  const maxRows = Math.max(1, Number(opts.maxRows ?? MAX_CONSTRAINT_ROWS))
  const maxChars = Math.max(80, Number(opts.maxChars ?? MAX_CONSTRAINT_CHARS))
  const rows = Array.isArray(oldRows) ? oldRows.map((row) => ({ ...row })) : []
  const CHANGE_CUE = /(改成|改为|调成|换成|不再|取消|只[能准])/
  for (const incoming of Array.isArray(newRows) ? newRows : []) {
    const isChange = CHANGE_CUE.test(incoming.text)
    const target = rows.find((row) => {
      if (row.kind !== incoming.kind) return false
      const score = overlap(row.text, incoming.text)
      // 有「改成」时阈值放低：同一件事换了数值，字面只差一两个字符。
      return score >= (isChange ? 0.5 : 0.8)
    })
    if (target === undefined) {
      rows.push({ ...incoming })
      continue
    }
    // 只有「改/换/调成」这类说法才算覆盖；单纯说法相近的，保留先说的那条。
    if (!isChange) continue
    if (Number(incoming.seq) >= Number(target.seq)) {
      const note = `（原 seq ${target.seq} 已被 seq ${incoming.seq} 改）`
      rows[rows.indexOf(target)] = { kind: incoming.kind, text: incoming.text, seq: incoming.seq, note }
    }
  }
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (KIND_ORDER[b.row.kind] ?? 0) - (KIND_ORDER[a.row.kind] ?? 0) || a.index - b.index)
    .map(({ row }) => row)
  const kept = []
  let chars = 0
  for (const row of sorted) {
    const cost = row.text.length + (row.note ?? '').length + 12
    if (kept.length >= maxRows) break
    if (chars + cost > maxChars) continue
    kept.push(row)
    chars += cost
  }
  return kept
}

/**
 * 渲染约束区；没有行时返回空串（不占地方）。
 * @param rows - 合并后的行。
 * @returns 多行文本。
 */
export function renderConstraints(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const lines = [HEAD]
  for (const row of rows) {
    const label = KIND_LABEL[row.kind] ?? '必须'
    const seq = Number(row.seq ?? 0) > 0 ? `（seq ${row.seq}）` : ''
    lines.push(`- [${label}] ${row.text}${row.note ?? ''}${seq}`)
  }
  return lines.join('\n')
}

/**
 * 把约束区嵌进编译条目最前。
 * @param entries - 已投影条目。
 * @param text - 渲染好的约束区。
 * @param seq - 该条目的 seq。
 * @returns 新条目数组。
 */
export function prependConstraintEntry(entries, text, seq) {
  if (text === '') return entries
  return [{ seq: Number(seq) || 0, kind: 'constraint', text }, ...(Array.isArray(entries) ? entries : [])]
}
