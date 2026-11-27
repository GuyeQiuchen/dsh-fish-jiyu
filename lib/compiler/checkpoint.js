/**
 * 检查点识别与「注入内容折成指针」（鲫鱼自己的实现）。
 *
 * 背景：记忆快照、规则注入这类内容，每次压缩后都会被宿主**重新注入一遍**。
 * 如果上一份检查点正文里完整留着它们，每压一次就多一份副本，纯属重复占地方。
 * 原文在会话日志里，取回工具能调回来，所以这里只把它们折成一行指针。
 *
 * 只处理「上一份检查点」的正文，活对话一个字都不扫。
 */

/** 这个 seq 的显示写法，全模块统一。 */
const seqRef = (seq) => `seq ${seq}`

/** 这是不是一份压缩检查点（宿主有两种历史形状）。 */
export function isCheckpointSource(source) {
  if (source === undefined || source === null) return false
  if (source.kind === 'compact-checkpoint') return true
  return source.kind === 'plugin' && source.plugin === 'compact'
}

/** 这条消息的来源是不是「配置里要求折叠」的那几类注入块。 */
export function isElidableSource(source, kinds) {
  if (kinds === undefined || kinds.length === 0) return false
  const kind = source?.kind
  return typeof kind === 'string' && kinds.includes(kind)
}

/** 折叠后指针里的中文名；没列到的直接用 kind，新来源也不会读不出来。 */
const ELIDABLE_LABELS = {
  'dsh-mnemon': '记忆快照',
  'agent-instructions': '规则与冷库索引',
  'skill-catalog': '技能清单',
  'runtime-context': '运行时上下文',
  'time-context': '时间上下文',
}

/** 记忆快照的开头标记：一个是路由提示，一个是正文标题。 */
const SNAPSHOT_MARKERS = ['MNEMON RUNTIME MEMORY SNAPSHOT', '[MNEMON]']
/** 快照里单个文件的结束标签。 */
const FILE_CLOSE = '</runtime-memory-file>'
/** 同一快照内两个文件块之间的连接文字，用来把两块算成一段。 */
const BLOCK_JOINER = /^\s*(?:MEMORY\.md \(working reference\)|USER\.md \(user profile\)|<runtime-memory-file )/
/** 本编译器自己产出的角色头；快照里不会出现它。 */
const ROLE_HEAD = /\n\[(?:user|assistant|tool)\]\s*\n/
/** 真正的规则注入块里一定有这几句之一。 */
const REMINDER_MARKERS = ['The following workspace instructions may be relevant', 'Instructions from:']
const REMINDER_PROOF_WINDOW = 600
const SNAPSHOT_MARKER_WINDOW = 800

/** 找出「被塞进检查点正文里的记忆快照」的字符区间。 */
function findSnapshotSpans(text) {
  const spans = []
  let from = 0
  while (from < text.length) {
    let markerAt
    for (const marker of SNAPSHOT_MARKERS) {
      const at = text.indexOf(marker, from)
      if (at !== -1 && (markerAt === undefined || at < markerAt)) markerAt = at
    }
    if (markerAt === undefined) break
    const firstFile = text.indexOf('<runtime-memory-file ', markerAt)
    if (firstFile === -1) break
    if (firstFile - markerAt > SNAPSHOT_MARKER_WINDOW) {
      from = markerAt + 1 // 只是正文里提到标记，不是真快照
      continue
    }
    let end
    let cursor = firstFile
    for (;;) {
      const close = text.indexOf(FILE_CLOSE, cursor)
      if (close === -1) break
      // 块被截断时找不到自己的结束标签，搜索会一路跑到下一个块的结束标签，
      // 把中间的活对话整段吞掉。角色头是安全的界：快照里不会有它。
      const head = ROLE_HEAD.exec(text.slice(cursor, close))
      if (head !== null) {
        end = cursor + head.index
        break
      }
      const after = close + FILE_CLOSE.length
      end = after
      cursor = after
      if (!BLOCK_JOINER.test(text.slice(after, after + 240))) break
    }
    if (end === undefined) break
    spans.push([markerAt, end])
    from = end
  }
  return spans
}

/** 找出真正框住 Workspace 规则的 <system-reminder> 包装。 */
function findReminderSpans(text) {
  const spans = []
  const pattern = /(?:^|\n)<system-reminder>\n/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const open = text.indexOf('<system-reminder>', match.index)
    const head = text.slice(open, open + REMINDER_PROOF_WINDOW)
    if (!REMINDER_MARKERS.some((marker) => head.includes(marker))) continue
    const close = text.indexOf('</system-reminder>', open)
    if (close === -1) continue
    spans.push([open, close + '</system-reminder>'.length])
  }
  return spans
}

/**
 * 把上一份检查点正文里的注入内容折成一行指针。
 * @returns `{ text, spans, chars }`——span 数与被折掉的字符数（给报告用）。
 */
export function elideInjectedBodies(text) {
  const spans = [...findSnapshotSpans(text), ...findReminderSpans(text)].sort((a, b) => a[0] - b[0])
  if (spans.length === 0) return { text, spans: 0, chars: 0 }
  let out = ''
  let cursor = 0
  let chars = 0
  let removed = 0
  for (const [start, end] of spans) {
    if (start < cursor) continue // 重叠时保留外层
    out += text.slice(cursor, start)
    const length = end - start
    chars += length
    removed += 1
    out += `[注入内容已压缩为指针（原文 ${length} 字符）— 压缩后会重新注入，原文可用 recall 调回]`
    cursor = end
  }
  out += text.slice(cursor)
  return { text: out, spans: removed, chars }
}

/** 折叠整段注入消息时用的指针行。 */
export function elidedSourceMarker(kind, seq, length) {
  const label = ELIDABLE_LABELS[kind] ?? kind
  return `[${label} 已压缩为指针（${seqRef(seq)}，原文 ${length} 字符）— 原文可用 recall 调回，且下一次压缩后会重新注入]`
}
