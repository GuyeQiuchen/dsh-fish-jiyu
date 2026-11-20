/**
 * 压缩决策报告工具（可删的小模块）。
 *
 * 与暂缓工具同一个形态：独立函数注册，宿主没给 tools 就安静跳过。
 * 它只读 last-report.json，不触发压缩，也不改任何东西。
 *
 * 模块化：删掉本文件、tool.js 里那两行调用、index.js 里写报告那一段即可回退。
 */
import { readHistory, readReport, reportText, historyText } from './report.js'

/**
 * 把 jiyu_inspect 挂到宿主上。
 * @param ctx - 插件上下文。
 * @returns 是否注册成功。
 */
export function registerInspectTool(ctx) {
  const tools = ctx?.tools ?? (typeof ctx?.get === 'function' ? ctx.get('tools') : undefined)
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return false
  const register = () =>
    tools.register({
      name: 'jiyu_inspect',
      description:
        '看最近一次压缩的决策报告：每块落在哪一档（原文 / 事实行 / 关键词）、压缩前后体积、上限与目标。压缩完想知道「为什么这么切」时用它。只读，不触发压缩。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxBlocks: { type: 'integer', minimum: 1, maximum: 200 },
          index: { type: 'integer', minimum: 0, maximum: 9 },
          list: { type: 'boolean' },
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
        if (args?.list === true) {
          return { text: historyText(readHistory()) }
        }
        const index = Number(args?.index ?? 0)
        const report = readReport(Number.isFinite(index) && index >= 0 ? index : 0)
        if (report === null) {
          return { text: '还没有压缩报告：等下一次自动压缩，或这份报告还没写出来。' }
        }
        const limit = Number(args?.maxBlocks)
        return { text: reportText(report, Number.isFinite(limit) && limit > 0 ? limit : 40) }
      },
    })
  if (typeof ctx.effect === 'function') ctx.effect(register)
  else register()
  return true
}
