/**
 * 鲫鱼引擎的盒子：对外只有这一个入口。
 *
 * 规矩（写死在这里，改之前先想清楚）：
 *   1. 插件（index.js）只许 import 本文件，不许深引用 rank/plan 等内部模块；
 *   2. 本目录内部的实现随便重写，**输出形状不许变**；
 *   3. 引擎不碰 fs、不碰宿主——块和条目都由调用方传进来。
 *
 * 变更记录见 CONTRACT.md。
 */
export {
  // 投影：把条目按块分成三档，产出 entries + stats
  projectRegion,
  // 块与渲染辅助（调用方拼报告、算成本要用）
  assignBlocks,
  buildIndexLine,
  factLine,
  keywordLine,
  blockKeywords,
  extractKeywords,
  hasFactContent,
  resultDigest,
  stripReminders,
  sessionAlert,
  unknownAlert,
  // 默认参数（改了算契约变更）
  DEFAULT_NEAR_SHARE,
  DEFAULT_FAR_SHARE,
  DEFAULT_FACT_CAP,
  DEFAULT_KEYWORD_CAP,
} from '../linear.js'

export { planProjection, TIER_POINTER, TIER_FACT, TIER_RAW, DEFAULT_HEADROOM, DEFAULT_FACT_SHARE } from '../plan.js'
