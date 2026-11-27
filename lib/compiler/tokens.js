/**
 * 词元估算与截断（鲫鱼自己的实现，0.4.27 起接管）。
 *
 * 只做三件事：把文本切成「词规模」的块、按 DeepSeek 文档的字符密度估 token、
 * 按预算截断并留下出处注记。全部确定性、不联网、不调模型。
 */

/** 词规模切分：字母串、数字串、单个标点、空白串。 */
const WORD_RE = /[a-zA-Z]+|[0-9]+|[^\sa-zA-Z0-9]|\s+/g

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/** 切成词规模的 token；空白也切出来，但从不计数。 */
export function tokenize(text) {
  return String(text ?? '').match(WORD_RE) ?? []
}

/** 该字符按「CJK 密度」（0.6 token/字）估，而不是 0.3。 */
export function isCjkDensity(char) {
  const code = char.codePointAt(0)
  if (code === undefined) return false
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x0e00 && code <= 0x0e7f) ||
    (code >= 0x0e80 && code <= 0x0eff) ||
    (code >= 0x0900 && code <= 0x097f) ||
    (code >= 0x0980 && code <= 0x09ff) ||
    (code >= 0x0a00 && code <= 0x0a7f) ||
    (code >= 0x0a80 && code <= 0x0aff) ||
    (code >= 0x0b00 && code <= 0x0b7f) ||
    (code >= 0x0b80 && code <= 0x0bff) ||
    (code >= 0x0c00 && code <= 0x0c7f) ||
    (code >= 0x0c80 && code <= 0x0cff) ||
    (code >= 0x0d00 && code <= 0x0d7f) ||
    (code >= 0x0d80 && code <= 0x0dff) ||
    (code >= 0x1000 && code <= 0x109f) ||
    (code >= 0x1780 && code <= 0x17ff)
  )
}

/** 按字符密度估 token（非 CJK 0.3 / CJK 0.6）。 */
export function estimateByDensity(text) {
  let wide = 0
  let narrow = 0
  for (const char of String(text ?? '')) {
    if (isCjkDensity(char)) wide += 1
    else narrow += 1
  }
  return (narrow * 3 + wide * 6) / 10
}

/** 非空白词元个数。 */
export function countWords(text) {
  let count = 0
  for (const token of tokenize(text)) if (token.trim().length > 0) count += 1
  return count
}

/**
 * 一条条目的预算尺寸：词元数，与字符密度估算取大。
 * 取大是为了让超长无空格串（base64、压缩过的代码）也能被预算看见。
 */
export function estimateEntryTokens(text) {
  return Math.max(countWords(text), Math.ceil(estimateByDensity(text)))
}

/** 去掉回车、ANSI 转义和控制字节。 */
export function sanitize(text) {
  if (typeof text !== 'string') return ''
  let out = text
  if (out.includes('\r')) out = out.replaceAll('\r', '')
  if (out.includes('\x1b')) out = out.replace(ANSI_RE, '')
  return out.replace(CONTROL_RE, '')
}

function trimBrokenSurrogateEnd(text) {
  const code = text.charCodeAt(text.length - 1)
  return code >= 0xd800 && code <= 0xdbff ? text.slice(0, -1) : text
}

function trimBrokenSurrogateStart(text) {
  const code = text.charCodeAt(0)
  return code >= 0xdc00 && code <= 0xdfff ? text.slice(1) : text
}

/**
 * 截到词元预算：保留原样文本，切了就加 `...(truncated from ref)`。
 * 同时受 `limit * 4` 字符上限约束（防止无空格长串钻空子）。
 */
export function truncateWords(text, limit, ref) {
  const tokens = tokenize(text)
  let count = 0
  let cut = tokens.length
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].trim().length === 0) continue
    count += 1
    if (count > limit) {
      cut = index
      break
    }
  }
  let out = cut >= tokens.length ? text : tokens.slice(0, cut).join('')
  let truncated = cut < tokens.length
  const maxChars = Math.max(32, limit * 4)
  if (out.length > maxChars) {
    out = trimBrokenSurrogateEnd(out.slice(0, maxChars))
    truncated = true
  } else if (truncated) {
    out = trimBrokenSurrogateEnd(out)
  }
  if (!truncated) return { text, truncated: false }
  out = out.replace(/\s+$/u, '')
  const marker = ref === undefined ? '...(truncated)' : `...(truncated from ${ref})`
  // 2026-11-27 修（审查 B9）：上面按「空格分词」数 limit，CJK 长串与无空格文本
  // 会被低估——实测 limit=10 出来 17 token，limit=0 还有 6 token。
  // 这里按真正的估算器复核，超了就二分往回切，切到装得下为止。
  const fit = (mark) => {
    let lo = 0
    let hi = out.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (estimateEntryTokens(trimBrokenSurrogateEnd(out.slice(0, mid)) + mark) <= limit) lo = mid
      else hi = mid - 1
    }
    return trimBrokenSurrogateEnd(out.slice(0, lo)).replace(/\s+$/u, '')
  }
  if (estimateEntryTokens(out + marker) > limit) {
    const longKept = fit(marker)
    const shortMark = '…'
    const shortKept = limit >= 2 ? fit(shortMark) : ''
    // 长标记（`...(truncated from seq 6)` 约 9 token）在小预算里会把正文挤没。
    // 这时改用单字符省略号：出处还能靠条目自己的 seq 追，正文没了就真没了。
    // 判断标准是「换短标记能多留住至少一倍正文」，避免大预算时也退化成省略号。
    if (shortKept.length > longKept.length * 2 && shortKept !== '') {
      return { text: `${shortKept}${shortMark}`, truncated: true }
    }
    if (longKept === '') return { text: '', truncated: true }
    out = longKept
  }
  return { text: out + marker, truncated: true }
}

/** 保留末尾 `limit` 个词元，前面切掉时加 `...(elided before ref)`。 */
export function tailWords(text, limit, ref) {
  const tokens = tokenize(text)
  let count = 0
  let start = tokens.length
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].trim().length > 0) {
      count += 1
      if (count > limit) break
    }
    start = index
  }
  let out = start === 0 ? text : tokens.slice(start).join('')
  let truncated = start > 0
  const maxChars = Math.max(32, limit * 4)
  if (out.length > maxChars) {
    out = trimBrokenSurrogateStart(out.slice(out.length - maxChars))
    truncated = true
  } else if (truncated) {
    out = trimBrokenSurrogateStart(out)
  }
  if (!truncated) return { text, truncated: false }
  return { text: (ref === undefined ? '...(elided before)' : `...(elided before ${ref})`) + out, truncated: true }
}
