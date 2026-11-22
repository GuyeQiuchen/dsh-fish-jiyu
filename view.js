/**
 * ⚠ 死代码，留着是历史，别照它改。
 *
 * Host half：两条只读路由，配合同目录的 client.js 和 inspect.html 用。
 * 那一半（client.js）注册不上去，界面上从来没出现过这一格，
 * 所以这两条路由虽然能开，也没人从界面上点进来。2026-11-20 删过一次，
 * 退版退到删除之前又回来了。要重做先读 DSH 的客户端模块加载逻辑。
 *
 * 现在要看压缩情况：用 `jiyu_inspect` 工具，同一份数据。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { reportPath } from './lib/report.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const name = 'jiyu-view'
export const inject = ['webServer']

/**
 * 造一个只读文件的 handler。
 * @param file - 文件路径，或返回路径的函数（每次请求现算）。
 * @param type - content-type。
 * @returns handler。
 */
function serve(file, type) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('GET only')
      return
    }
    try {
      const target = typeof file === 'function' ? file(req) : file
      const body = await readFile(target)
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'content-length': body.length,
      })
      if (req.method === 'HEAD') res.end()
      else res.end(body)
    } catch (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`读不到：${String(error?.message ?? error)}`)
    }
  }
}

/**
 * 从请求 URL 里取会话 id。
 * @param req - HTTP 请求。
 * @returns 会话 id，空串表示读全局报告。
 */
function sessionOf(req) {
  try {
    const url = new URL(String(req?.url ?? '/'), 'http://localhost')
    return String(url.searchParams.get('session') ?? '').trim().slice(0, 120)
  } catch {
    return ''
  }
}

/**
 * 挂路由。
 * @param ctx - 插件上下文。
 */
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-fish-jiyu/inspect.html',
      handler: serve(path.join(HERE, 'inspect.html'), 'text/html; charset=utf-8'),
    }),
  )
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-fish-jiyu/report.json',
      handler: serve((req) => reportPath(sessionOf(req)), 'application/json; charset=utf-8'),
    }),
  )
}
