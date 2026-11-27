/** 盒子的边界：插件只能从 api.js 进引擎，引擎不碰 fs、不反向依赖插件。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8')

test('index.js 只从 api.js 进引擎（不许深引用）', () => {
  const source = read('index.js')
  for (const deep of ["'./lib/linear.js'", "'./lib/plan.js'", "'./lib/engine/rank.js'"]) {
    assert.ok(!source.includes(deep), `index.js 不许 import ${deep}`)
  }
  assert.ok(source.includes("'./lib/engine/api.js'"), 'index.js 应经 api.js 进引擎')
})

test('引擎不碰文件系统和宿主', () => {
  for (const file of ['lib/engine/api.js', 'lib/linear.js', 'lib/plan.js']) {
    const source = read(file)
    assert.ok(!source.includes("'node:fs'"), `${file} 不许 import node:fs`)
    assert.ok(!source.includes('from \'./index.js\''), `${file} 不许反向依赖插件`)
  }
})

test('api.js 导出契约里列的东西', async () => {
  const api = await import('../lib/engine/api.js')
  for (const name of ['projectRegion', 'planProjection', 'assignBlocks', 'buildIndexLine', 'DEFAULT_FACT_CAP', 'DEFAULT_KEYWORD_CAP']) {
    assert.ok(name in api, `api 缺 ${name}`)
  }
})

test('废弃方案不许被插件引用', () => {
  const source = read('index.js')
  for (const dead of ['allocation.js', 'window.js']) {
    assert.ok(!source.includes(dead), `index.js 不许引用已否决的 ${dead}`)
  }
})

test('宿主依赖只许 lib/host.js 一处 import', () => {
  const files = ['index.js', 'tool.js', 'view.js', 'client.js']
  const walk = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const rel = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${rel}/`)
      else if (entry.name.endsWith('.js')) files.push(rel)
    }
  }
  walk('lib/')
  const offenders = []
  for (const file of files) {
    if (file === 'lib/host.js') continue
    // 只看真正的 import 语句；注释里提到包名不算
    if (/^\s*import[^\n]*from\s+['"]@deepseek-ai\//m.test(read(file))) offenders.push(file)
  }
  assert.deepEqual(offenders, [], '除 lib/host.js 外不许直接 import 宿主包')
})
