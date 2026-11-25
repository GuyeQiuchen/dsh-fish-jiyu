/**
 * 块类型判定：哪些是正文、哪些是草稿、哪些是真不认识。
 * 2026-11-24 为什么单独成文件：index.js 依赖宿主 SDK，测试起不来；
 * 这段逻辑只跟消息结构有关，放到 lib 里既能被单测，也能被压缩和取回共用。
 */

/** 已知的「草稿」类型：模型的自言自语，不进上下文，也不该被当成未知格式报警。 */
export const DRAFT_TYPES = new Set(['reasoning', 'thinking'])

/**
 * 数出这条消息里「不在白名单内、但有文本」的块，按类型累计字符。
 * 草稿类型不记账——它是主动排除的，不是“不认识”；混进去会淹没真的未知格式。
 * @param message - 消息对象。
 * @param into - 累加用的 Map<类型, 字符数>。
 */
export function unknownTypesOf(message, into) {
  const content = message?.content
  if (!Array.isArray(content) || into === undefined) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (typeof block.text !== 'string' || block.text === '') continue
    const type = String(block.type ?? '(无类型)')
    if (type === 'text') continue
    if (DRAFT_TYPES.has(type)) continue
    into.set(type, (into.get(type) ?? 0) + block.text.length)
  }
}
