/**
 * 压缩决策报告（可删的小模块）。
 *
 * 解决的问题：压缩完之后，只有一句话「压了多少 token」，看不出每块被怎么处理、为什么。
 * 这里把投影时算好的东西摊开成一张表：哪块保了原文、哪块降成一行事实、哪块只剩关键词，
 * 各自是什么档位。它就是压缩侧的「上下文洞察」——不是看上下文由什么组成，是看引擎怎么切的。
 *
 * 模块化：删掉本文件、index.js 里写报告那两处、tool.js 里的 jiyu_inspect 即可回退。
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** 档位名，给人看。 */
export const TIER_NAMES = {
  0: '原文',
  1: '事实行',
  2: '关键词',
}

/** 分档理由，给人看。 */
export const TIER_REASONS = {
  near: '离得最近',
  work: '动过工具',
  related: '和当前话题沾边',
  time: '按时间距离',
}

/** 留几次压缩的报告。 */
const HISTORY_LIMIT = 10

/** 最多留几个会话的报告文件；更多就按修改时间删最老的，免得目录无限长。 */
const SESSION_FILES_LIMIT = 40

/**
 * 把一个会话 id 变成安全的文件名片段。
 * @param session - 会话 id。
 * @returns 文件名片段。
 */
function safeName(session) {
  return String(session ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 120)
}

/**
 * DSH_HOME（或用户主目录下的 .dsh）里的 fish-jiyu 目录。
 * @returns 绝对路径。
 */
export function reportDir() {
  const home = String(process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
  return path.join(home, 'fish-jiyu')
}

/**
 * 报告文件路径。给了会话就按会话分开存，没给就是全局那份（工具和旧页面读它）。
 * @param session - 会话 id，可空。
 * @returns 绝对路径。
 */
export function reportPath(session = '') {
  const id = safeName(session)
  if (id === '') return path.join(reportDir(), 'last-report.json')
  return path.join(reportDir(), 'reports', `${id}.json`)
}

/**
 * 写报告；写不出也不抛。最近的几条一起留着，能看前后两次的差别。
 * @param report - makeReport 的结果。
 * @returns 是否写成。
 */
export function writeReport(report) {
  try {
    const session = String(report?.session ?? '')
    const file = reportPath(session)
    const history = readHistory(session)
    const next = [report, ...history].slice(0, HISTORY_LIMIT)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
    // 全局那份顺带更新一次：jiyu_inspect 不传会话时读它，看到的仍是最后一次压缩。
    if (session !== '') {
      const globalFile = reportPath('')
      const globalHistory = readHistory('')
      mkdirSync(path.dirname(globalFile), { recursive: true })
      writeFileSync(globalFile, JSON.stringify([report, ...globalHistory].slice(0, HISTORY_LIMIT), null, 2), 'utf8')
    }
    pruneReports()
    return true
  } catch {
    return false
  }
}

/**
 * 清理老的会话报告文件，只留最近若干个。
 *
 * 每个会话一个文件，会话多了目录会一直长；这里按修改时间留最近的那批。
 * 删不动、读不到都当没发生——报告不是关键路径，不能因为它出错。
 * @param limit - 最多留几个，默认 40。
 * @returns 删掉几个。
 */
export function pruneReports(limit = SESSION_FILES_LIMIT) {
  const keep = Number(limit)
  if (!Number.isFinite(keep) || keep <= 0) return 0
  try {
    const dir = path.join(reportDir(), 'reports')
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const full = path.join(dir, name)
        try {
          return { full, at: statSync(full).mtimeMs }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at)
    let removed = 0
    for (const file of files.slice(keep)) {
      try {
        unlinkSync(file.full)
        removed += 1
      } catch {
        /* 单个删不掉就跳过 */
      }
    }
    return removed
  } catch {
    return 0
  }
}

/**
 * 读历史（最新在前）。旧格式（单个对象）也能读，当成只有一条。
 * @param session - 会话 id；空则读全局那份。
 * @returns 报告数组。
 */
export function readHistory(session = '') {
  try {
    const data = JSON.parse(readFileSync(reportPath(session), 'utf8'))
    if (Array.isArray(data)) return data.filter((item) => item !== null && typeof item === 'object')
    return data !== null && typeof data === 'object' ? [data] : []
  } catch {
    return []
  }
}

/**
 * 读最近一份报告；没有或坏了返回 null。
 * @param index - 第几份，0 是最新。
 * @param session - 会话 id；空则读全局那份。
 * @returns 报告对象或 null。
 */
export function readReport(index = 0, session = '') {
  const list = readHistory(session)
  const at = Number(index)
  if (!Number.isFinite(at) || at < 0) return list[0] ?? null
  return list[Math.floor(at)] ?? null
}

/**
 * 造一份报告。
 * @param input - `{ at, provider, cap, target, before, after, stats, shadowed }`。
 * @returns 报告对象。
 */
export function makeReport(input = {}) {
  const stats = input.stats ?? {}
  const tiers = Array.isArray(stats.tiers) ? stats.tiers : []
  const blocks = tiers.map((item) => ({
    seq: `${item.start}-${item.end}`,
    tier: item.tier,
    tierName: TIER_NAMES[item.tier] ?? String(item.tier),
    reason: item.reason ?? '',
    reasonName: TIER_REASONS[item.reason] ?? '',
    // 硬信息标记：翻回去才说得准的东西在哪几块。只进报告，不进上下文。
    marks: Array.isArray(item.marks) ? item.marks : [],
  }))
  const after = Number(stats.tokens ?? input.after ?? 0)
  const before = Number(input.before ?? 0)
  return {
    at: input.at ?? new Date().toISOString(),
    session: String(input.session ?? ''),
    provider: String(input.provider ?? ''),
    shadowed: input.shadowed ?? null,
    cap: Number(input.cap ?? 0),
    target: Number(input.target ?? 0),
    before,
    after,
    ratio: before > 0 ? Number((after / before).toFixed(3)) : null,
    summary: {
      blocks: Number(stats.blocks ?? blocks.length),
      keep: Number(stats.keep ?? 0),
      near: Number(stats.near ?? 0),
      mid: Number(stats.mid ?? 0),
      far: Number(stats.far ?? 0),
      indexWords: Number(stats.indexWords ?? 0),
    },
    blocks,
  }
}

/**
 * 报告转成一屏能读完的文本。
 * @param report - makeReport 的结果。
 * @param maxBlocks - 最多列几块（默认全列，太长时截断）。
 * @returns 文本。
 */
export function reportText(report, maxBlocks = 40) {
  const r = report ?? {}
  const s = r.summary ?? {}
  const lines = []
  const when = String(r.at ?? '').slice(0, 19).replace('T', ' ')
  lines.push(`压缩报告 ${when} · ${r.provider ?? ''}`)
  if (r.shadowed !== null && r.shadowed !== undefined) {
    lines.push(`遮蔽 seq ${r.shadowed.start}-${r.shadowed.end}，约 ${r.shadowed.tokens ?? '?'} tokens`)
  }
  lines.push(`上限 ${r.cap}，目标 ${r.target}，压完 ${r.after}${r.ratio === null ? '' : `（原体积的 ${Math.round(r.ratio * 100)}%）`}`)
  lines.push(`块 ${s.blocks}：原文 ${s.near}、事实行 ${s.mid}、关键词 ${s.far}；索引词 ${s.indexWords}`)
  const blocks = Array.isArray(r.blocks) ? r.blocks : []
  const shown = blocks.slice(0, maxBlocks)
  for (const block of shown) {
    const why = block.reasonName === '' ? '' : `（${block.reasonName}）`
    const marks = Array.isArray(block.marks) && block.marks.length > 0 ? ` [${block.marks.join('')}]` : ''
    lines.push(`  seq ${block.seq} → ${block.tierName}${why}${marks}`)
  }
  if (blocks.length > shown.length) lines.push(`  …还有 ${blocks.length - shown.length} 块`)
  return lines.join('\n')
}

/**
 * 最近几次压缩的概览，最新在前。
 * @param list - 报告数组。
 * @returns 文本。
 */
export function historyText(list) {
  const items = Array.isArray(list) ? list : []
  if (items.length === 0) return '还没有压缩记录。'
  return items
    .map((item, i) => {
      const when = String(item.at ?? '').slice(0, 16).replace('T', ' ')
      const ratio = item.ratio === null || item.ratio === undefined ? '?' : Math.round(item.ratio * 100)
      return `${i === 0 ? '最新' : `第 ${i + 1} 新`}  ${when}  ${item.before} → ${item.after}（${ratio}%）块 ${item.summary?.blocks ?? '?'}`
    })
    .join('\n')
}
