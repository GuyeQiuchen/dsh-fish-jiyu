/**
 * 噪声剥除（鲫鱼自己的实现，0.4.27 起接管）。
 *
 * 只做剥除，不做总结：把 IDE 标记、系统提醒、任务通知这类「不是对话」的
 * XML 块整段去掉，再把 <command-name>/<command-args> 这层包装拆掉。
 */

/** 默认要整段剥掉的块；顺序无关，每个都用 `s` 标志按整体匹配。 */
export const DEFAULT_NOISE_PATTERNS = [
  '<ide_opened_file>.*?</ide_opened_file>',
  '<ide_selection>.*?</ide_selection>',
  '<system-reminder>.*?</system-reminder>',
  '<command-message>.*?</command-message>',
  '<task-notification>.*?</task-notification>',
]

/** 这层标签只拆壳、不删内容。 */
const UNWRAP_RE = /<\/?(?:command-name|command-args)>/g

/**
 * 把配置里的字符串编译成正则。
 * 写错一条就抛错并指出是哪条——静默跳过会让用户以为剥掉了。
 */
export function compileNoisePatterns(sources) {
  return sources.map((source, index) => {
    try {
      // 带 g：一条消息里可能出现多个同类块（例如两段 system-reminder），
      // 不带 g 只会剥掉第一个，剩下的原样进上下文。
      return new RegExp(source, 'gs')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`noisePatterns[${index}] (${JSON.stringify(source)}) 不是合法正则：${reason}`)
    }
  })
}

/**
 * 剥掉噪声块、拆掉包装标签，最后 trim。
 *
 * ⚠️ 2026-11-27 线上事故：配置对象被 `deepFreeze` 冻结，冻结的正则连
 * `lastIndex` 都不可写；带 `g` 的正则参与 `String.replace` 时会去设它，
 * 于是抛 `Cannot assign to read only property 'lastIndex'`，每一次压缩都在
 * 45 毫秒内失败、且不留报告。修法：每次用局部重建的正则，冻结的那个只当模板。
 */
export function stripNoise(text, patterns) {
  let out = String(text ?? '')
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    out = out.replace(new RegExp(pattern.source, flags), '')
  }
  out = out.replace(UNWRAP_RE, '')
  return out.trim()
}
