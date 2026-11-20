/**
 * 暂缓自动压缩（可删的小模块）。
 *
 * 为什么只做这一半：billion-context 的实测说，模型驱动的收益主要来自「能拒绝」和
 * 「能选区间」，而不是「压得勤」。全自动那套要模型在压缩前被调一次，又慢又贵；
 * 所以这里只做一次否决权——压力触发的自动压缩可以被推迟，溢出触发的不拦（那是救命）。
 *
 * 模块化：删掉本文件 + index.js 里 constructor 那次注册、compactIfNeeded 覆写，
 * 就干净回退，投影逻辑一个字都不用动。
 */
const DEFAULT_HOURS = 1

let holdUntil = 0
let holdReason = ''

/**
 * 推迟自动压缩。
 * @param hours - 小时数，缺省 1。
 * @param reason - 一句理由。
 * @returns 当前状态。
 */
export function holdFor(hours = DEFAULT_HOURS, reason = '') {
  const span = Number(hours)
  const safe = Number.isFinite(span) && span > 0 ? Math.min(24, span) : DEFAULT_HOURS
  holdUntil = Date.now() + safe * 60 * 60 * 1000
  holdReason = String(reason ?? '').trim().slice(0, 80)
  return holdState()
}

/**
 * 取消暂缓。
 * @returns 当前状态。
 */
export function clearHold() {
  holdUntil = 0
  holdReason = ''
  return holdState()
}

/**
 * 现在是否处于暂缓期。
 * @param now - 时间戳，测试用。
 * @returns 布尔。
 */
export function isHeld(now = Date.now()) {
  return now < holdUntil
}

/**
 * 状态快照。
 * @param now - 时间戳。
 * @returns `{ held, remainMinutes, reason }`。
 */
export function holdState(now = Date.now()) {
  const held = isHeld(now)
  return {
    held,
    remainMinutes: held ? Math.max(1, Math.round((holdUntil - now) / 60000)) : 0,
    reason: held ? holdReason : '',
  }
}

/**
 * 把工具挂到宿主上；拿不到 tools 服务就安静跳过。
 * 注册必须落在 ctx.effect 作用域里（Cordis 会回收裸注册），所以这里优先走 effect。
 * @param ctx - 插件上下文。
 * @returns 是否注册成功。
 */
export function registerHoldTool(ctx) {
  const tools = ctx?.tools ?? (typeof ctx?.get === 'function' ? ctx.get('tools') : undefined)
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return false
  const register = () =>
    tools.register({
      name: 'jiyu_hold',
      description:
        '推迟下一次压力触发的自动压缩（默认一小时，最多 24）。用于「这段内容我还在用，先别折」。溢出触发的强制压缩不受影响。传 0 小时等于取消暂缓。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hours: { type: 'number', minimum: 0, maximum: 24 },
          reason: { type: 'string', maxLength: 80 },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        render: (_args, result) => [{ type: 'text', text: result.text }],
      },
      async execute(args) {
        const hours = Number(args?.hours ?? DEFAULT_HOURS)
        const state = hours > 0 ? holdFor(hours, args?.reason ?? '') : clearHold()
        return { text: JSON.stringify({ status: 'ok', ...state }) }
      },
    })
  if (typeof ctx.effect === 'function') ctx.effect(register)
  else register()
  return true
}
