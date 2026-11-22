/**
 * dsh-fish-jiyu —— 线性投影压缩引擎。
 *
 * 换掉 vcc 的 `compile()`（唯一被写明的扩展点），其余（触发时机、保留区、
 * 事务回滚、surface 协议）全部沿用 vcc：那些和策略无关，是踩过的坑。
 * vcc 的引擎与编译器已经搬进 lib/vcc/，本包不再要求使用者另装它。
 *
 * 投影规则（lib/linear.js）：
 *   - 最近几块：原文逐条保留；
 *   - 中段：每块一行事实（时间、你的话、动过什么、收尾、seq 区间）；
 *   - 远段：每块只剩关键词，外加一条「关键词 → seq」索引，供 search/recall 取回。
 * 旧检查点一律折成指针，避免上一次的检查点正文被原样重复（雪球的根）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { assignBlocks, projectRegion, buildIndexLine, resultDigest } from './lib/linear.js'
// —— 决策报告（可删）：写一份 last-report.json，供 jiyu_inspect 读。
import { makeReport, writeReport } from './lib/report.js'
// —— 暂缓模块（可删）：工具入口在 tool.js；这里只用状态判断。
import { isHeld, holdState } from './lib/hold.js'
// —— 搬运诊断：模块被执行时留个时间戳，用来区分「没被加载」和「加载了但没激活」。
// 写到本包目录，不用管运行时的家目录在哪。
function markAlive(text) {
  try {
    writeFileSync(path.join(import.meta.dirname, 'loaded.txt'), text, 'utf8')
  } catch {
    /* 写不了就算了 */
  }
}
markAlive(new Date().toISOString())

// —— 搬进来的 vcc 引擎与编译器：本包自带，不依赖外部装 vcc。
// 加载失败时先把错误落盘再照常抛，免得只在界面上显示成「没激活」。
function recordLoadError(what, error) {
  try {
    const dir = path.join(homedir(), '.dsh', 'fish-jiyu')
    mkdirSync(dir, { recursive: true })
    const text = `[${new Date().toISOString()}] ${what}\n${String(error?.stack ?? error)}\n`
    writeFileSync(path.join(dir, 'load-error.txt'), text, 'utf8')
  } catch {
    /* 连诊断都写不进去就算了 */
  }
}

import DefaultEngine from './lib/vcc/engine.js'
import * as COMPILER from './lib/vcc/compiler.js'

/** vcc 的编译器：借它的逐条渲染（工具一行、噪声剥除、检查点识别），不借它的截断尺度。 */
const estimateTokens = COMPILER.estimateEntryTokens ?? ((text) => String(text ?? '').length)

/** 检查点里写的后端名，验收时认这个。 */
const PROVIDER = 'dsh-fish-jiyu'
const MODEL = 'jiyu-v1'

/** 最近几块永远保原文，留给「刚才那段话」。 */
const DEFAULT_NEAR_BLOCKS = 3
/** 中段一行事实的最大字符数。 */
const DEFAULT_MID_MAX = 140
/** 远段每块最多几个关键词。 */
const DEFAULT_FAR_WORDS = 6
/** vcc 的检查点上限兜底值（它自己的默认）。 */
const DEFAULT_CAP = 65536
/** 近段逐条渲染的放宽尺度：比 vcc 默认的 512/1024 宽，近段更接近原话。 */
const NEAR_TEXT_TOKENS = 2048
const NEAR_USER_TOKENS = 4096
/** 投影至少要压掉一成，否则不如直接交基类的结果。 */
const SHRINK_KEEP = 0.85
/** 读不到 thresholdRatio 时按这个算（vcc 的默认是 0.5，本机配的是 0.35）。 */
const DEFAULT_THRESHOLD = 0.35
/** 目标取触发线的这一份：压完落在线下，才不会一压再压。 */
const TARGET_SHARE = 0.5

/**
 * 把比例夹在 (0, 1] 之间：配置写歪了也不能让目标变成负数或无穷。
 * @param value - 原始比例。
 * @returns 可用的比例。
 */
function clampRatio(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_THRESHOLD
  return value > 1 ? 1 : value
}

/**
 * 按 seq 取一条会话事件，兼容新版访问器与旧的 events 数组。
 * @param session - 会话对象。
 * @param seq - 事件序号。
 * @returns 事件对象或 undefined。
 */
function eventAt(session, seq) {
  if (session === null || session === undefined) return undefined
  if (typeof session.eventAt === 'function') {
    const event = session.eventAt(seq)
    return event === null ? undefined : event
  }
  const events = session.events
  if (!Array.isArray(events)) return undefined
  return events.find?.((item) => item?.seq === seq)
}

/** 消息 → 纯文本，兼容字符串和文本块数组。 */
function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 把待压区段的节点整理成块划分的输入。
 * @param prepared - vcc 传进来的已计价快照。
 * @returns `{ seq, role, text, time, tool }[]`。
 */
/**
 * 扫一遍工具结果，记两套索引：
 *   - `byCall`：调用 id → 结果摘要，给块的「结果」用；
 *   - `byResult`：结果 seq → `{ digest, error }`，给近段的工具行补一句结果。
 * 结果原文不进上下文，摘要最长几十字，其余按 seq 取回。
 * @param prepared - 已计价快照。
 * @returns `{ byCall, byResult }`。
 */
function collectToolDigests(prepared) {
  const byCall = new Map()
  const byResult = new Map()
  for (const seq of prepared.shadowedSeqs) {
    let event
    try {
      event = eventAt(prepared.session, seq)
    } catch {
      continue
    }
    const type = String(event?.type ?? '')
    if (!type.includes('tool') || !type.includes('result')) continue
    const message = event?.data?.message ?? event?.data
    const digest = resultDigest(textOf(message))
    if (digest === '') continue
    const callId = String(message?.toolCallId ?? message?.source?.callId ?? '')
    const error =
      message?.isError === true ||
      /(error|fail|exception|traceback|denied|not found|错误|失败|异常)/i.test(digest)
    if (callId !== '') byCall.set(callId, digest)
    byResult.set(Number(seq), { digest, error })
  }
  return { byCall, byResult }
}

/**
 * 近段的工具行补一句结果：只补失败的那种（成功与否正文里通常说了），
 * 这样「当时为什么没成」不用再翻日志也能看见。
 * @param entries - 编译出来的条目。
 * @param byResult - 结果 seq → `{ digest, error }`。
 * @returns 新条目数组。
 */
function enrichNearEntries(entries, byResult) {
  if (byResult.size === 0) return entries
  return entries.map((entry) => {
    if (entry.kind !== 'tool') return entry
    const match = /->\s*result\s+(\d+)/.exec(String(entry.text ?? ''))
    if (match === null) return entry
    const info = byResult.get(Number(match[1]))
    if (info === undefined || !info.error) return entry
    return { ...entry, text: `${entry.text} · 结果 ${info.digest}` }
  })
}

function collectNodes(prepared, digests = new Map()) {
  const out = []
  for (const seq of prepared.shadowedSeqs) {
    let event
    try {
      event = eventAt(prepared.session, seq)
    } catch {
      continue
    }
    if (event === undefined || event === null) continue
    const type = String(event?.type ?? '')
    const source = event?.data?.source ?? event?.source
    const kind = String(source?.kind ?? '')
    // 只有 source.kind === 'user' 才是人真正打的字；time-context、runtime-context、
    // skill-catalog、tool-jobs、compact-checkpoint 这些是注入的，不当话题块。
    const isUser = type.includes('user') && kind === 'user'
    const isAssistant = type.includes('assistant')
    let text = ''
    if (isUser || isAssistant) {
      try {
        text = textOf(prepared.session.deriveEventMessage(event))
      } catch {
        text = ''
      }
    }
    out.push({
      seq: Number(seq),
      role: isUser ? 'user' : isAssistant ? 'assistant' : 'other',
      text,
      time: event?.time,
      tool: type === 'tool/call' || type === 'tool-call'
        ? String(event?.data?.name ?? event?.data?.toolName ?? event?.data?.tool?.name ?? '')
        : '',
      note: type === 'tool/call' || type === 'tool-call'
        ? digests.get(String(event?.data?.callId ?? event?.data?.id ?? '')) ?? ''
        : '',
    })
  }
  return out
}

/**
 * 待压区段 → 编译器节点 `{ seq, message }`。
 * @param prepared - 已计价快照。
 * @returns 节点数组（按 seq 升序）。
 */
function collectCompileNodes(prepared) {
  const out = []
  for (const seq of prepared.shadowedSeqs) {
    const event = eventAt(prepared.session, Number(seq))
    if (event === undefined || event === null) {
      throw new Error(`surface seq ${seq} has no matching session event (corrupt surface)`)
    }
    let message = null
    try {
      message = prepared.session.deriveEventMessage(event)
    } catch {
      message = null
    }
    out.push({ seq: Number(seq), message })
  }
  return out
}

/**
 * 检查点总量上限：先问引擎自己的解析（vcc 会返回 checkpointCap），再退回配置，最后用默认。
 * @param engine - 引擎实例。
 * @param prepared - 已计价快照。
 * @returns cap（编译器 token）。
 */
function resolveCap(engine, prepared) {
  const inherited = Number(engine?.effectiveMaxTokens?.(prepared?.shadowedTokenCount) ?? 0)
  if (Number.isFinite(inherited) && inherited > 0) return inherited
  const configured = Number(engine?.config?.checkpointCap ?? 0)
  if (Number.isFinite(configured) && configured > 0) return configured
  return DEFAULT_CAP
}

/**
 * 从已计价快照里取会话 id；拿不到就空串（报告退回全局那份，不按会话分）。
 * @param prepared - 已计价快照。
 * @returns 会话 id。
 */
function sessionIdOf(prepared) {
  const session = prepared?.session
  const id = session?.id ?? session?.sessionId ?? prepared?.sessionId ?? ''
  return String(id ?? '')
}

export class FishLinearEngine extends DefaultEngine {
  /** 设置面板另开一节，别和 vcc、fold 抢同一个键。 */
  static SETTINGS_NAMESPACE = 'compaction-jiyu'

  /**
   * 压力触发的自动压缩可以被暂缓（这就是那一次否决权）；溢出触发的不拦，那是救命。
   * 暂缓状态由 tool.js 那个独立入口写入。
   * @param agent - 压缩上下文。
   * @param trigger - `pressure` 或 `context-overflow`。
   * @param signal - 取消信号。
   * @returns 压缩结果；暂缓中返回 null。
   */
  async compactIfNeeded(agent, trigger, signal) {
    if (trigger === 'pressure' && isHeld()) {
      const state = holdState()
      try {
        console.warn(
          `compaction-jiyu: 自动压缩暂缓中，还剩 ${state.remainMinutes} 分钟${state.reason === '' ? '' : `（${state.reason}）`}`,
        )
      } catch {
        /* 没有 stderr 也不能影响判断 */
      }
      return null
    }
    return super.compactIfNeeded(agent, trigger, signal)
  }

  /**
   * 投影一次压缩。
   *
   * 只向 vcc 借两样东西：触发与通道（父类的事务、surface 协议），以及它的条目
   * 渲染器（工具一行、噪声剥除、旧检查点识别）。条目由本引擎自己按放宽的尺度
   * 重新编，所以近段拿到的是接近原话的行，而不是 vcc 已经截过一遍的产物。
   *
   * @param prepared - 已计价的选择快照。
   * @param agent - 签名位（本引擎不派模型调用）。
   * @param signal - 取消信号。
   * @returns 检查点条目、统计、后端来源。
   */
  async compile(prepared, agent, signal) {
    const base = await super.compile(prepared, agent, signal)
    const result = { ...base, provider: PROVIDER, model: MODEL }
    const compileNodes = COMPILER.compileNodes
    if (typeof compileNodes !== 'function') {
      return { ...result, linear: { skipped: 'no-compiler' } }
    }
    try {
      signal?.throwIfAborted()
      const cap = resolveCap(this, prepared)
      const digests = collectToolDigests(prepared)
      const nodes = collectCompileNodes(prepared)
      const blocks = assignBlocks(collectNodes(prepared, digests.byCall))
      if (nodes.length === 0 || blocks.length === 0) {
        return { ...result, linear: { skipped: 'empty-region' } }
      }
      // 近段按放宽尺度逐条编：这样投影的输入是「更接近原话」的行。
      const budget = {
        textTokens: Math.max(Number(this.config?.textTokens ?? 0), NEAR_TEXT_TOKENS),
        userTextTokens: Math.max(Number(this.config?.userTextTokens ?? 0), NEAR_USER_TOKENS),
        toolCallTokens: Number(this.config?.toolCallTokens ?? 0) || 128,
        toolResultExcerptTokens: Number(this.config?.toolResultExcerptTokens ?? 0),
      }
      const generous = compileNodes(nodes, { ...this.config, maxTokens: cap }, budget)
      const baseTokens = Number(base?.stats?.tokens ?? 0)
      const generousTokens = Number(generous?.stats?.tokens ?? 0)
      // 目标挂在「触发线」上，而不是检查点上限上：上限的一半比触发线还高，
      // 压完人还在触发线上头，会反复压。取触发线的一半，压完才落回线下。
      // 触发线 = 上限 × thresholdRatio（本机上限就是窗口，所以等于窗口 × 阈值）。
      const threshold = clampRatio(Number(this.config?.thresholdRatio ?? DEFAULT_THRESHOLD))
      const triggerTokens = cap * threshold
      const targetTokens = Math.max(
        1024,
        Math.floor(
          Math.min(triggerTokens * TARGET_SHARE, Math.max(generousTokens, baseTokens) * SHRINK_KEEP),
        ),
      )
      const projected = projectRegion({
        entries: enrichNearEntries(generous.entries ?? [], digests.byResult),
        blocks,
        targetTokens,
        estimate: estimateTokens,
        nearBlocks: DEFAULT_NEAR_BLOCKS,
        midMax: DEFAULT_MID_MAX,
        farWords: DEFAULT_FAR_WORDS,
      })
      const after = projected.stats.tokens
      // 压不掉还不如不压：交给父类结果，别硬投影出一个更大的检查点。
      if (baseTokens > 0 && after >= baseTokens * 0.98) {
        return { ...result, linear: { skipped: 'not-smaller', baseTokens, generousTokens, after } }
      }
      // 留一份决策报告给 jiyu_inspect 读：每块落在哪一档、为什么。
      // 顺带记下这次盖住的 seq 范围，被折掉的原文按区间回原始日志取。
      const seqs = projected.entries.map((entry) => Number(entry?.seq)).filter((n) => Number.isFinite(n) && n > 0)
      writeReport(
        makeReport({
          session: sessionIdOf(prepared),
          provider: PROVIDER,
          cap,
          target: targetTokens,
          before: baseTokens,
          after,
          stats: projected.stats,
          shadowed: result?.shadowedRange,
          // 不用展开：条目上万时 Math.min(...seqs) 会爆调用栈
          seqFrom: seqs.length ? seqs.reduce((a, b) => (a < b ? a : b)) : 0,
          seqTo: seqs.length ? seqs.reduce((a, b) => (a > b ? a : b)) : 0,
        }),
      )
      return {
        ...result,
        entries: projected.entries,
        capped: after > cap,
        stats: { ...base.stats, ...generous.stats, tokens: after, entries: projected.entries.length },
        linear: {
          baseTokens,
          generousTokens,
          after,
          cap,
          targetTokens,
          blocks: blocks.length,
          near: projected.stats.near,
          mid: projected.stats.mid,
          far: projected.stats.far,
          indexWords: projected.stats.indexWords,
        },
      }
    } catch (error) {
      // 投影失败不能连累压缩本身：退回 vcc 原样结果。
      try {
        console.warn(`compaction-jiyu: projection skipped: ${String(error?.message ?? error)}`)
      } catch {
        /* 没 stderr 也不能挂 */
      }
      return result
    }
  }
}

/** 供离线测试直接引用（不经过宿主）。 */
export {
  assignBlocks,
  projectRegion,
  buildIndexLine,
  collectNodes,
  collectToolDigests,
  enrichNearEntries,
  estimateTokens,
  collectCompileNodes,
  resolveCap,
}

/**
 * 插件级 Config：宿主拿它校验 entry 里那段 config。
 * 之前只给了类的 static Config，模块没导出——loader 读不到 schema 就跳过整条 entry，
 * 表现成「开关是开的、引擎没激活」。这条必须留在模块顶层。
 */
export const Config = FishLinearEngine.Config

export default FishLinearEngine
