/**
 * 跨平台与加载诊断：两个真实踩过的坑（溯 2026-11-25 报的）。
 *
 * 1. PowerShell 5.1 把无 BOM 的 UTF-8 当 ANSI 读。install.ps1 开头自己写着
 *    "Keep this file ASCII-only"，正文却有中文注释——结果整个脚本解析失败，
 *    报错位置（93 行）和真病因（87 行）隔得老远。
 * 2. index.js 里 lib/vcc 原来是静态 import：依赖链断一环，模块直接抛错，
 *    recordLoadError 永远轮不到调用，用户只看到「未运行」，零信息。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('install.ps1 / uninstall.ps1 必须是纯 ASCII（PS 5.1 会把无 BOM UTF-8 当 ANSI）', () => {
  for (const name of ['install.ps1', 'uninstall.ps1']) {
    const text = readFileSync(path.join(HERE, name), 'utf8')
    const bad = [...text].filter((ch) => ch.codePointAt(0) > 127)
    assert.equal(bad.length, 0, `${name} 里有 ${bad.length} 个非 ASCII 字符：${bad.slice(0, 10).join('')}`)
  }
})

test('index.js 不许静态 import 引擎/编译器（否则加载失败时没诊断）', () => {
  const text = readFileSync(path.join(HERE, 'index.js'), 'utf8')
  const staticImport = /^import\s+[^\n]*from\s+['"]\.\/lib\/(vcc|engine|compiler)\//m.test(text)
  assert.equal(staticImport, false, '引擎与编译器必须用动态 import，并在 catch 里 recordLoadError 后 rethrow')
  assert.match(text, /recordLoadError\('加载 lib\/engine/)
})

test('引擎 import 失败时：写出 load-error.txt 且照样抛出', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jiyu-load-'))
  const home = path.join(root, 'home')
  try {
    cpSync(HERE, root, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.endsWith('.tgz'),
    })
    unlinkSync(path.join(root, 'lib/engine/base.js'))
    const script = `
      try { await import(${JSON.stringify(path.join(root, 'index.js'))}) ; console.log('NO-THROW') }
      catch (error) { console.log('THREW') }
    `
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      // load-error 现在与报告同口径：优先 DSH_HOME。测试要把这个也指进临时目录，
      // 否则会读到宿主环境里的 DSH_HOME，写到真实家目录去。
      env: { ...process.env, HOME: home, DSH_HOME: path.join(home, '.dsh') },
      encoding: 'utf8',
    })
    assert.match(out, /THREW/, '加载失败必须抛出，不能静默')
    const errFile = path.join(home, '.dsh', 'fish-jiyu', 'load-error.txt')
    assert.ok(existsSync(errFile), 'load-error.txt 应该被写出来')
    assert.match(readFileSync(errFile, 'utf8'), /加载 lib\/engine/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
