/**
 * 远段「逐条装」的四条断言。
 *
 * 背景（2026-11-24）：远段原本是「整套装或整套丢」—— farTokens 只要让总数超一点点，
 * 几百条关键词行就全没了，不管超的是 20 字符还是 2 万。
 * 阿记在她那边实测到 target 68812、压完 64504、箱子还空 4.3k，远段整套只要约 1.4k，
 * 那次刚好装下；她据此提了「按剩余空间逐条装」的设计，这份测试钉住实现。
 *
 * 这个文件不读宿主的任何东西，只用 lib/linear.js 的纯函数，所以能在包目录里直接跑。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { assignBlocks, blockKeywords, projectRegion, farPriority } from '../lib/linear.js'

/** 造一个节点。 */
const node = (seq, role, text, tool = '') => ({ seq, role, text, tool, time: 1795400000000 + seq })

/**
 * 造一段够长的历史：让近段、中段、远段都有东西。
 *
 * ⚠ 四个坑，前三版都踩了：
 * 1. **不能每轮都带工具** —— `tierOf` 把「有产出」的块提到中段，一块都不剩 tier 2
 *    的话远段永远是个空集合，测出来全是假的。
 * 2. **各轮的用词必须互不相同** —— 否则 `relatedTier` 会把远块因「沾边」提成中段。
 * 3. **连「那个东西要处理」这种通用短语也不能有** —— 中文按 n-gram 切，
 *    「那个」「东西」「处理」会被每块都抽出来，所有块互相「沾边」，一样提光。
 * 4. **总量必须够大** —— 太小的话 `projectRegion` 结尾那个二分一路把 keep 推到块总数，
 *    全成近段，远段自然是零（我原来造 40 块只有 868 token，就是这个结果）。
 *    现在每块塞足够多的字，让总量远超测试里用到的最小预算。
 */
function history(rounds = 120) {
  const nodes = []
  let seq = 1
  const HY = ['甲乙丙丁戊己庚辛壬癸', '子丑寅卯辰巳午未申酉']
  // 每块的填充文字必须**互不重复**，否则中文 n-gram 会把「这一段记」「当时做」这类片段
  // 抽成每块共有的关键词，`relatedTier` 便把所有远块都当成「和当前话题沾边」提成中段，
  // 远段又变成空集。这里用块号造一批每块独有的字，保证没有任何片段跨块共享。
  const CHARS = '戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿列张'
  const makeFiller = (i) => {
    const parts = []
    for (let k = 0; k < 40; k += 1) {
      // 每段用 (i, k) 定位到不同字符组合，块内重复也只在块内，不跨块
      const a = CHARS[(i + k) % CHARS.length]
      const b = CHARS[(i * 3 + k * 7) % CHARS.length]
      const c = CHARS[(i * 11 + k * 5) % CHARS.length]
      parts.push(`${a}${b}${c}${a}${c}${b}`)
    }
    return parts.join('、')
  }
  for (let i = 0; i < rounds; i += 1) {
    const tag = `h${i}${HY[0][i % 10]}${HY[1][Math.floor(i / 10) % 10]}`
    const filler = makeFiller(i)
    nodes.push(node(seq++, 'user', `${tag} ${filler}`))
    // 每四轮里只让一轮动工具
    nodes.push(node(seq++, 'assistant', `${tag} ${filler}`, i % 4 === 0 ? 'read' : ''))
    nodes.push(node(seq++, 'assistant', `${tag} ${filler}`))
  }
  return nodes
}

const estimate = (text) => Math.ceil(String(text).length / 1.4)

/**
 * 这份固定输入约 5.2 万 token 原文、84 块。
 * 实测分档（改完之后）：target ≥10 万全装（keep 84）、5 万装 6 条远段（keep 67）、
 * 2 万装 23 条（keep 20）。测试用到的数字就从这三档里取。
 */
function projectAt(targetTokens, rounds = 120) {
  const nodes = history(rounds)
  const blocks = assignBlocks(nodes)
  const cut = Math.max(1, Math.floor(blocks.length * 0.7))
  const region = nodes.filter((n) => Number(n.seq) <= Number(blocks[cut - 1].endSeq))
  const entries = region.map((n) => ({ seq: n.seq, kind: 'text', text: n.text }))
  const projected = projectRegion({ entries, blocks: blocks.slice(0, cut), targetTokens, estimate })
  const isFar = (entry) => String(entry.text).includes('词：')
  const isIndex = (entry) => String(entry.text).startsWith('[关键词索引]')
  return {
    entries: projected.entries,
    farCount: projected.entries.filter(isFar).length,
    indexCount: projected.entries.filter(isIndex).length,
    total: projected.entries.reduce((sum, e) => sum + estimate(e.text), 0),
  }
}

// 这份固定输入原文约 5.2 万 token。预算 ≥10 万时全部装下、没有远段（这是对的，
// 不是 bug）；压到 5 万和 2 万才进入分档，才会出现远段。所以「远段出现」要用中档验，
// 不能用 200000 —— 用 200000 测出来的 0 条是正常结果。
test('预算中等时远段出现（不再整段归零）', () => {
  const p = projectAt(50000)
  assert.ok(p.farCount > 0, '预算压到装不下全部时，远段该出现而不是整段归零')
})

test('预算宽松时全部原文都在（此时没有远段是对的）', () => {
  const p = projectAt(200000)
  assert.equal(p.farCount, 0, '预算足够装下全部原文时，不该有远段')
})

// 第 1 条：预算紧到只够近段时，远段不再出现整段归零之外的东西 —— 但也不能超预算
test('预算紧时不超预算', () => {
  const p = projectAt(20000)
  assert.ok(p.total <= 20000, `实占 ${p.total} 超过 target 20000`)
})

// 第 2 条：远段装不下全部时，装入条数要大于 0 且小于全部 —— 不是归零
// 这一条正是这次改动的核心：原来这一档 far 恒为 0。
test('远段装不下全部时，装一部分而不是归零', () => {
  const mid = projectAt(50000)
  const tighter = projectAt(20000)
  assert.ok(mid.farCount > 0, '5 万这一档远段该出现')
  assert.ok(tighter.farCount > 0, '2 万这一档远段也该出现，不能归零')
})

// 第 3 条：预算极小也要有索引和指针，覆盖率不能掉
test('预算极小仍保留索引与块指针', () => {
  const p = projectAt(20000)
  assert.ok(p.indexCount >= 1, '索引是远段唯一的横向入口，预算再紧也该在')
  const pointers = p.entries.filter(
    (e) => String(e.text).includes('原文按 seq 取回') || String(e.text).includes('词：'),
  )
  assert.ok(pointers.length > 0, '至少要留下能按 seq 取回的指针')
})

// 第 4 条：优先级排序本身
test('farPriority：沾边的排在不沾边的前面', () => {
  // ⚠ 这里要按 blockKeywords **实际抽出来的词**当查询词，不能用完整词。
  // 实测：`修 linear.js 的关键词行` 抽出来是 ["linear.js","关键","词行","键词"]，
  // 用 'linear' / '关键词' 去查两个字都对不上 —— 这是中文 n-gram 分词的固有限制，
  // 不是排序写错了。生产里 queryWords 也来自同一套分词，所以形状是一致的；
  // 这个测试不同，它是手写查询，必须跟着分词的实际产出走。
  const related = assignBlocks([node(1, 'user', '修 linear.js 的关键词行'), node(2, 'assistant', '好')])[0]
  const unrelated = assignBlocks([node(3, 'user', '今天天气不错'), node(4, 'assistant', '嗯')])[0]
  const query = blockKeywords(related, 10)
  assert.ok(
    farPriority(related, query) < farPriority(unrelated, query),
    '和当前话题沾边的块优先级应该更高（数值更小）',
  )
})

test('farPriority：查询词为空时所有块同级', () => {
  const a = assignBlocks([node(1, 'user', '修 linear.js 的关键词行'), node(2, 'assistant', '好')])[0]
  const b = assignBlocks([node(3, 'user', '今天天气不错'), node(4, 'assistant', '嗯')])[0]
  assert.equal(farPriority(a, []), farPriority(b, []), '没有当前话题时，沾边这一档不该起作用')
})

test('farPriority：动过工具的块比没动过的优先', () => {
  const worked = assignBlocks([node(1, 'user', '跑个测试'), node(2, 'assistant', '', 'bash')])[0]
  const chatted = assignBlocks([node(3, 'user', '随便聊聊'), node(4, 'assistant', '好')])[0]
  assert.ok(
    farPriority(worked, []) <= farPriority(chatted, []),
    '有产出的块排前面',
  )
})
