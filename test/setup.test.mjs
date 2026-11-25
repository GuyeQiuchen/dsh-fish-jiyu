/**
 * 一键安装脚本（scripts/setup.mjs）。
 *
 * 这些坑都是真出过的：
 *   · 用 /^- id:/ 匹配缩进过的行 → 漏匹配 → 重复插入 → DSH 报重复 id；
 *   · 装完不核对，配置没生效也打印 done；
 *   · 出错留半装状态；
 *   · 把 compaction-jiyu 的配置行当重复条目删掉（2026-11-25 真机上干过一次）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRow, removeRow, setDisabled, validatePatch } from '../scripts/setup.mjs'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PATCH_FULL = `- id: compaction-vcc
  disabled: false

- id: compaction-jiyu
  config:
    thresholdRatio: 0.35

- id: tool-result-pruner
  config:
    thresholdChars: 2000
    headChars: 1200
    tailChars: 500

- id: fish-chat
  config:
    wake: false
`

/** 造一个临时 DSH_HOME + profile。 */
function makeHome(patchText = PATCH_FULL) {
  const home = mkdtempSync(path.join(tmpdir(), 'jiyu-setup-'))
  const dir = path.join(home, 'profiles', 'web')
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'p', version: '0.0.1', dependencies: {}, dsh: { profile: { bundles: ['dsh-compaction-vcc'] } } }, null, 2)}\n`,
  )
  if (patchText !== null) writeFileSync(path.join(dir, 'cordis.patch.yml'), patchText)
  return { home, dir }
}

function run(home, args = []) {
  return execFileSync(process.execPath, [path.join(HERE, 'scripts/setup.mjs'), '--profile', 'web', ...args], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
}

test('findRow 只认缩进 0 的 - id:（缩进条目不算新条目）', () => {
  const lines = ['- id: a', '  x: 1', '', '- id: b', '  y: 2']
  assert.deepEqual(findRow(lines, 'a'), { start: 0, end: 3 })
  assert.deepEqual(findRow(lines, 'b'), { start: 3, end: 5 })
  assert.equal(findRow(lines, 'c'), null)
})

test('setDisabled 幂等：已经 disabled 就不再重复插一行', () => {
  const lines = ['- id: compaction-vcc', '  disabled: true']
  assert.equal(setDisabled(lines, 'compaction-vcc').changed, false)
  assert.deepEqual(lines, ['- id: compaction-vcc', '  disabled: true'])
})

test('removeRow 只删那一条', () => {
  const lines = ['- id: a', '  x: 1', '', '- id: b', '  y: 2']
  assert.equal(removeRow(lines, 'a'), true)
  assert.equal(findRow(lines, 'a'), null)
  assert.ok(findRow(lines, 'b'))
})

test('validatePatch 抓出重复 id', () => {
  const result = validatePatch('- id: a\n- id: a\n')
  assert.equal(result.problems.length, 1)
  assert.match(result.problems[0], /id 重复/)
})

test('全新 profile：依赖、bundle、配置都到位，且 compaction-jiyu 不被删', () => {
  const { home, dir } = makeHome()
  try {
    const out = run(home)
    assert.match(out, /完成/)
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    assert.ok(pkg.dependencies['dsh-fish-jiyu'].startsWith('link:'))
    assert.ok(pkg.dsh.profile.bundles.includes('dsh-fish-jiyu'))
    const patch = readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /- id: compaction-jiyu/, '不能删掉主人的配置行')
    assert.match(patch, /thresholdRatio: 0.35/)
    assert.match(patch, /- id: compaction-vcc\n  disabled: true/)
    assert.doesNotMatch(patch, /thresholdChars: 2000/, '旧剪裁阈值要撤掉')
    assert.ok(existsSync(path.join(dir, 'node_modules', 'dsh-fish-jiyu', 'index.js')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('重复跑是幂等的：两次之后内容一样', () => {
  const { home, dir } = makeHome()
  try {
    run(home)
    const first = readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8')
    const firstPkg = readFileSync(path.join(dir, 'package.json'), 'utf8')
    run(home)
    assert.equal(readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), first)
    assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), firstPkg)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('--dry-run 不写盘', () => {
  const { home, dir } = makeHome()
  try {
    const before = readFileSync(path.join(dir, 'package.json'), 'utf8')
    run(home, ['--dry-run'])
    assert.equal(readFileSync(path.join(dir, 'package.json'), 'utf8'), before)
    assert.equal(existsSync(path.join(dir, 'node_modules', 'dsh-fish-jiyu')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('patch 结构坏了：不装、退出码非 0、文件还原', () => {
  const broken = '- id: fish-chat\n- id: fish-chat\n'
  const { home, dir } = makeHome(broken)
  try {
    assert.throws(() => run(home), (error) => error.status !== 0)
    assert.equal(readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8'), broken)
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.dependencies['dsh-fish-jiyu'], undefined, '失败时不该留下依赖')
    assert.equal(existsSync(path.join(dir, 'node_modules', 'dsh-fish-jiyu')), false, '失败时不该留下半装的包')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('--verify-only 能看出符号链接', () => {
  const { home, dir } = makeHome()
  try {
    run(home)
    const target = path.join(dir, 'node_modules', 'dsh-fish-jiyu')
    rmSync(target, { recursive: true, force: true })
    symlinkSync(path.join(HERE), target)
    assert.throws(() => run(home, ['--verify-only']), (error) => {
      assert.match(String(error.stdout), /符号链接/)
      return error.status !== 0
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
