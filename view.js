/**
 * Host half：把压缩决策页喂给 Web GUI。
 *
 * 两条 GET 路由：
 *   /dsh-fish-jiyu/inspect.html           — 页面本体，每次请求从磁盘读，改 HTML 刷新即可，不用重启
 *   /dsh-fish-jiyu/report.json?session=…  — 这个会话最近几次压缩的报告；不带 session 读全局那份
 *
 * 按钮在 client.js。这一层只发文件，不碰压缩逻辑。
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
