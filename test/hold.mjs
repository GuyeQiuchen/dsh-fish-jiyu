/**
 * 暂缓模块的独立测试：只测状态机，不依赖宿主。
 * 删掉暂缓功能时，连带删掉本文件即可。
 */
import assert from 'node:assert'
import { holdFor, clearHold, isHeld, holdState } from '../lib/hold.js'

// 一、默认不暂缓
assert.equal(isHeld(), false, '默认不该处于暂缓期')
assert.deepEqual(holdState(), { held: false, remainMinutes: 0, reason: '' })

// 二、暂缓一小时后生效，且带理由和剩余分钟
const state = holdFor(1, '这段还在用')
assert.equal(state.held, true)
assert.ok(state.remainMinutes > 0 && state.remainMinutes <= 60, `剩余分钟应落在 1–60，实际 ${state.remainMinutes}`)
assert.equal(state.reason, '这段还在用')
assert.equal(isHeld(), true)

// 三、过期自动失效
const later = Date.now() + 61 * 60 * 1000
assert.equal(isHeld(later), false, '超过暂缓时间应自动失效')
assert.equal(holdState(later).held, false)

// 四、可以取消
holdFor(3, '临时')
clearHold()
assert.equal(isHeld(), false, '取消后不该还在暂缓')

// 五、上限夹住：超过 24 小时按 24 算
const long = holdFor(999)
assert.ok(long.remainMinutes <= 24 * 60, `最长 24 小时，实际 ${long.remainMinutes} 分钟`)
clearHold()

console.log('hold tests: ok')
