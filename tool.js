/**
 * 暂缓工具入口（独立 entry，和 vcc 的 tool-recall 一个形态）。
 *
 * 为什么不塞进引擎类的 constructor：宿主只把声明过的服务注入给插件，
 * 引擎类里拿不到 tools；裸注册也会被 Cordis 回收。所以单独一个 entry，
 * 声明 inject: ['tools']，在 apply 里用 ctx.effect 注册。
 *
 * 模块化：删掉本文件、package.json 的 "./tool" 导出、cordis.patch.yml 里
 * jiyu-hold 那一行，工具就没了；引擎那半（compactIfNeeded 覆写）仍能工作，
 * 只是没人能调它。
 */
import { registerHoldTool } from './lib/hold.js'
import { registerInspectTool } from './lib/inspect.js'

export const name = 'jiyu-hold'
export const inject = ['tools']

/**
 * 挂工具。
 * @param ctx - 插件上下文。
 */
export function apply(ctx) {
  try {
    registerHoldTool(ctx)
  } catch (error) {
    console.warn(`compaction-jiyu: hold tool skipped: ${String(error?.message ?? error)}`)
  }
  try {
    registerInspectTool(ctx)
  } catch (error) {
    console.warn(`compaction-jiyu: inspect tool skipped: ${String(error?.message ?? error)}`)
  }
}
