/**
 * 相关性分档的测试：远处的块如果和「正在干的事」沾边，要从关键词行升到事实行。
 * 删掉相关性分档时，连带删掉本文件。
 */
import assert from 'node:assert'
import { tierOf } from '../lib/linear.js'

const block = {
  startSeq: 1,
  endSeq: 10,
  time: Date.now() - 7200000,
  quotes: ['风扇曲线又调了一版，3558 rpm 稳住'],
  tools: ['edit'],
  notes: ['修改完成'],
  title: '风扇曲线',
  ending: '调好了',
}

// 一、不给当前话题：远处那块还是关键词档（老行为不变）
// 用一个没动过工具的块，免得「有产出提一档」把结果搅浑
const plain = { ...block, tools: [], notes: [] }
assert.equal(tierOf(0, 10, 1, plain), 2, '没有话题时应退回关键词档')

// 二、重叠两个词：提一档到事实行
assert.equal(tierOf(0, 10, 1, block, ['风扇', '曲线']), 1, '和当前话题重叠应提档')

// 三、只重叠一个词：不提，避免满屏都是相关的
assert.equal(tierOf(0, 10, 1, plain, ['风扇', '天气']), 2, '只中一个词不该提档')

// 四、近距离那块不受影响，仍是原文档
assert.equal(tierOf(9, 10, 1, block, ['风扇', '曲线']), 0, '近段本来就保原文')

// 五、端到端在这层测不了：projectRegion 的近段原文来自 vcc 编译结果（entries），
// 空 entries 时它会把 keep 拉到全部块、结果只有近段。真实链路由 test/acceptance.mjs
// 拿真会话日志覆盖，这一条只看分档本身。

console.log('relevance tests: ok')
