/**
 * 故障面的离线部分：配置坏掉、目标策略、暂缓、设置命名空间。
 *
 * 说明（别误会覆盖面）：引擎实例需要宿主 ctx（`ctx.reflect.provide` 等），
 * 离线造不出真实例，所以「压力/溢出/回滚/连压」四条要真引擎才能跑，
 * 归到副本演练；这里锁的是**不需要实例就能验**的那部分。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig, resolveTargetPolicy, TargetPressureConfigError } from '../lib/engine/base.js'
import { holdFor, clearHold, isHeld, holdState } from '../lib/hold.js'

test('坏配置在解析时就被拒，且说清是哪一项', () => {
  assert.throws(() => resolveConfig({ thresholdRatio: 2 }), /thresholdRatio.*\(0, 1\]/)
  assert.throws(() => resolveConfig({ checkpointCap: 0 }), /checkpointCap/)
  assert.throws(() => resolveConfig({ toolResultExcerptTokens: 0 }), /toolResultExcerptTokens/)
})

test('模型单独的策略覆盖全局，没覆盖时用全局值', () => {
  const config = resolveConfig({ thresholdRatio: 0.35, modelPolicies: [
    { provider: 'a', model: 'x', thresholdRatio: 0.5, maxOverflowRetries: 3 },
  ] })
  const hit = resolveTargetPolicy(config, { provider: 'a', model: 'x' })
  assert.equal(hit.thresholdRatio, 0.5)
  assert.equal(hit.maxOverflowRetries, 3)
  const miss = resolveTargetPolicy(config, { provider: 'a', model: 'y' })
  assert.equal(miss.thresholdRatio, 0.35)
  assert.equal(typeof miss.maxOverflowRetries, 'number')
})

test('目标策略配置失败带着 targetKey（去重警告靠它）', () => {
  const error = new TargetPressureConfigError('a/x', '坏配置')
  assert.equal(error.targetKey, 'a/x')
  assert.match(error.message, /坏配置/)
})

test('暂缓：压得住压力触发，也会自己到期', () => {
  clearHold()
  assert.equal(isHeld(), false)
  holdFor(0.5, '测试')
  assert.equal(isHeld(), true)
  assert.equal(holdState().reason, '测试')
  // 一小时后再问：已过期
  assert.equal(isHeld(Date.now() + 60 * 60 * 1000), false)
  clearHold()
  assert.equal(isHeld(), false)
})

test('设置命名空间是鲫鱼自己的，不与 vcc 抢同一个键', async () => {
  const { FishLinearEngine } = await import('../index.js')
  assert.equal(FishLinearEngine.SETTINGS_NAMESPACE, 'compaction-jiyu')
})

// ── 监听器层的四条：用小假 ctx 造真实例（宿主用到的只有 reflect/on/inject/logger）──
import DefaultEngine from '../lib/engine/base.js'

function makeEngine(config = {}) {
  const handlers = new Map()
  const logs = []
  const ctx = {
    reflect: { provide: () => {}, get: () => undefined, set: () => {}, delete: () => {} },
    on: (name, fn) => {
      handlers.set(name, fn)
      return () => handlers.delete(name)
    },
    inject: (deps, cb) => cb({ settings: undefined, effect: () => () => {}, watch: () => {}, reflect: ctx.reflect }),
    logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) },
    tokenMeter: { measure: () => ({ tokens: 1 }) },
    sessions: {},
    effect: () => () => {},
  }
  return { engine: new DefaultEngine(ctx, config), handlers, logs }
}

const signal = { aborted: false, throwIfAborted() {} }
const result = { shadowedSeqs: [1, 2], shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 10 }

test('pre-step：压成功就记一行，不阻断这一回合', async () => {
  const { engine, handlers, logs } = makeEngine()
  engine.compactIfNeeded = async () => result
  let nexted = 0
  await handlers.get('agent/pre-step')({ agent: {}, signal }, () => { nexted += 1 })
  assert.equal(nexted, 1)
  assert.ok(logs.some(([level, m]) => level === 'info' && m.includes('shadowed 2 surface nodes')))
})

test('pre-step：压失败只警告，回合照走（不许把整轮拖死）', async () => {
  const { engine, handlers, logs } = makeEngine()
  engine.compactIfNeeded = async () => { throw new Error('boom') }
  let nexted = 0
  await handlers.get('agent/pre-step')({ agent: {}, signal }, () => { nexted += 1 })
  assert.equal(nexted, 1)
  assert.ok(logs.some(([level, m]) => level === 'warn' && /step compaction failed: boom/.test(m)))
})

test('pre-step：同一个目标的配置错误只警告一次', async () => {
  const { engine, handlers, logs } = makeEngine()
  engine.compactIfNeeded = async () => { throw new TargetPressureConfigError('a/x', '坏配置') }
  const call = () => handlers.get('agent/pre-step')({ agent: {}, signal }, () => {})
  await call()
  const afterFirst = logs.filter(([level, m]) => level === 'warn' && m.includes('step compaction failed')).length
  await call()
  const afterSecond = logs.filter(([level, m]) => level === 'warn' && m.includes('step compaction failed')).length
  assert.equal(afterFirst, 1)
  assert.equal(afterSecond, 1, '第二次不该再刷同一条警告')
})

test('auto=false：不注册任何自动压缩监听', () => {
  const { handlers } = makeEngine({ auto: false })
  assert.equal(handlers.size, 0)
})

test('回合结束或新回复到达：清掉溢出重试计数', () => {
  const { engine, handlers } = makeEngine()
  const agent = {}
  const session = {}
  engine.overflowRetries.set(agent, 1)
  engine.overflowAgents.set(session, agent)
  handlers.get('agent/status')({ agent, status: 'idle' })
  assert.equal(engine.overflowRetries.has(agent), false)

  engine.overflowRetries.set(agent, 1)
  engine.overflowAgents.set(session, agent)
  handlers.get('session/event')(session, { type: 'assistant/message' })
  assert.equal(engine.overflowRetries.has(agent), false)
})

test('溢出恢复：压成功且 surface 前进了就 retry，并记一次重试', async () => {
  const { engine, handlers } = makeEngine()
  let generation = 0
  const session = {
    requestHeader: () => ({ config: { provider: 'a', model: 'b' } }),
    surface: { get replaceGeneration() { return generation } },
  }
  const agent = { session }
  engine.compactIfNeeded = async () => { generation += 1; return result }
  const out = await handlers.get('agent/request-error')({ agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal }, () => ({ kind: 'next' }))
  assert.deepEqual(out, { kind: 'retry' })
  assert.equal(engine.overflowRetries.get(agent), 1)
})

test('溢出恢复：超过上限就不再压（防止无限重试）', async () => {
  const { engine, handlers } = makeEngine({ maxOverflowRetries: 1 })
  let generation = 0
  const session = {
    requestHeader: () => ({ config: { provider: 'a', model: 'b' } }),
    surface: { get replaceGeneration() { return generation } },
  }
  const agent = { session }
  let calls = 0
  engine.compactIfNeeded = async () => { calls += 1; generation += 1; return result }
  engine.overflowRetries.set(agent, 1)
  const out = await handlers.get('agent/request-error')({ agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal }, () => ({ kind: 'next' }))
  assert.deepEqual(out, { kind: 'next' })
  assert.equal(calls, 0)
})

test('溢出恢复：失败且 surface 没前进，保留原始错误不 retry', async () => {
  const { engine, handlers, logs } = makeEngine()
  const session = {
    requestHeader: () => ({ config: { provider: 'a', model: 'b' } }),
    surface: { replaceGeneration: 0 },
  }
  const agent = { session }
  engine.compactIfNeeded = async () => { throw new Error('compile died') }
  const out = await handlers.get('agent/request-error')({ agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal }, () => ({ kind: 'next' }))
  assert.deepEqual(out, { kind: 'next' })
  assert.ok(logs.some(([level, m]) => level === 'warn' && m.includes('context-overflow compaction failed: compile died')))
})

test('投影配置真的传得下去（engine / 比例 / 单行封顶）', () => {
  const c = resolveConfig({ engine: 'plan', nearShare: 0.7, farShare: 0.3, factCap: 48, keywordCap: 18 })
  assert.equal(c.engine, 'plan')
  assert.equal(c.nearShare, 0.7)
  assert.equal(c.farShare, 0.3)
  assert.equal(c.factCap, 48)
  assert.equal(c.keywordCap, 18)
  // 不写时用默认
  const d = resolveConfig({})
  assert.equal(d.engine, 'time')
  // 写错要报出来，不许静默丢
  assert.throws(() => resolveConfig({ engine: 'plan2' }), /must be "time" or "plan"/)
  assert.throws(() => resolveConfig({ nearShare: 1.5 }), /nearShare/)
})
