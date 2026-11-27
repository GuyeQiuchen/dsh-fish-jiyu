/**
 * 成本模型规划器（重做引擎 M1）：一次算出来，不试。
 *
 * 为什么不再二分：二分是「拿渲染结果反复试」，263 块要跑三秒；而 0.4.21 给每行
 * 加了 token 上限之后，成本已经可以预先算出来。那就可以直接解出「最近连续几块
 * 保原文、往前几块留事实行」，再一次性渲染。
 *
 * 硬约束（和现在线上一致，不许破）：
 *   1. 原文必须是**最近连续的一段**，不许按价值挑散；
 *   2. 事实行紧跟原文，同样连续；
 *   3. 剩下的块每块一行指针，保证「每块都有落脚点」；
 *   4. 确定性：同样输入永远同样输出。
 *
 * 纯函数、不碰 IO、不调模型。
 */
export const TIER_POINTER = 0
export const TIER_FACT = 1
export const TIER_RAW = 2

/** 默认预留：给约束区、报告、以及估算误差。 */
export const DEFAULT_HEADROOM = 0.05
/** 中段（事实行）硬性份额：不这么切，中段会被指针和远段挤到只剩个位数。 */
export const DEFAULT_FACT_SHARE = 0.2

/**
 * 规划一次投影。
 * @param input - `{ blocks, costOf, target, indexCost, headroom }`
 *   - `costOf(index, tier)`：该块在这一档要花多少 token（调用方按封顶后的渲染器算）；
 *   - `indexCost`：全局索引那一行要花多少；
 *   - `headroom`：预留比例。
 * @returns `{ tiers, k, m, tokens, counts }`。
 */
export function planProjection(input) {
  const blocks = Array.isArray(input.blocks) ? input.blocks : []
  const costOf = input.costOf
  const target = Math.max(0, Number(input.target ?? 0))
  const indexCost = Math.max(0, Number(input.indexCost ?? 0))
  const headroom = Math.min(0.5, Math.max(0, Number(input.headroom ?? DEFAULT_HEADROOM)))
  const factShare = Math.min(0.8, Math.max(0, Number(input.factShare ?? DEFAULT_FACT_SHARE)))
  const n = blocks.length
  const counts = { raw: 0, fact: 0, pointer: 0 }
  if (n === 0) return { tiers: [], k: 0, m: 0, tokens: indexCost, counts }

  const cost = (index, tier) => Math.max(0, Number(costOf(index, tier)) || 0)
  const tiers = new Array(n).fill(TIER_POINTER)
  if (target <= 0) {
    for (let i = 0; i < n; i += 1) tiers[i] = TIER_RAW
    return { tiers, k: n, m: 0, tokens: 0, counts: { raw: n, fact: 0, pointer: 0 } }
  }

  const budget = Math.floor(target * (1 - headroom)) - indexCost
  // 垫底：每块一行指针（最小落脚点）
  let used = 0
  for (let i = 0; i < n; i += 1) used += cost(i, TIER_POINTER)
  if (used > budget) {
    // 连指针都装不下：那就全给指针，至少保证有落脚点（超预算由上层 cap 处理）
    counts.pointer = n
    return { tiers, k: 0, m: 0, tokens: used + indexCost, counts }
  }

  // 1) 原文：从最新往回连续装，但只用「原文份额」（1 - factShare）
  const rawBudget = Math.floor((budget - used) * (1 - factShare))
  const rawBase = used
  let k = 0
  for (let i = n - 1; i >= 0; i -= 1) {
    const step = cost(i, TIER_RAW) - cost(i, TIER_POINTER)
    if (used - rawBase + step > rawBudget) break
    if (used + step > budget) break
    tiers[i] = TIER_RAW
    used += step
    k += 1
  }

  // 2) 事实行：接着往回连续装，至少给 factShare 的份额（装得下就装）
  const factBudget = Math.floor((budget - used) * (factShare / Math.max(1e-9, 1 - factShare)))
  const factBase = used
  let m = 0
  for (let i = n - 1 - k; i >= 0; i -= 1) {
    const step = cost(i, TIER_FACT) - cost(i, TIER_POINTER)
    if (used - factBase + step > factBudget) break
    if (used + step > budget) break
    tiers[i] = TIER_FACT
    used += step
    m += 1
  }

  // 3) 还有余钱：继续把事实行往更老的方向铺（原文段不能再扩，它必须贴着最新）
  for (let i = n - 1 - k - m; i >= 0; i -= 1) {
    const step = cost(i, TIER_FACT) - cost(i, TIER_POINTER)
    if (used + step > budget) break
    tiers[i] = TIER_FACT
    used += step
    m += 1
  }

  // 4) 余钱还给原文：事实行那份一旦用不完，先前按比例划走的预算就白空了。
  //    从最新的事实块往回逐块升级为原文，装不下就停（仍然连续、仍然确定）。
  //    实测：0.4.23 那次 target 68,812，预算 65.4k，只花掉 58.2k，空 7.2k。
  for (let i = n - 1 - k; i >= 0 && m > 0; i -= 1) {
    const step = cost(i, TIER_RAW) - cost(i, TIER_FACT)
    if (used + step > budget) break
    tiers[i] = TIER_RAW
    used += step
    k += 1
    m -= 1
  }

  counts.raw = k
  counts.fact = m
  counts.pointer = n - k - m
  return { tiers, k, m, tokens: used + indexCost, counts }
}
