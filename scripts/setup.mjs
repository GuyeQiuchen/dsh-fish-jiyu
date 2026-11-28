#!/usr/bin/env node
/**
 * 一键安装 / 配置 dsh-fish-jiyu。
 *
 * 为什么单独写这个脚本：2026-11-19 到 11-25 这段时间，安装出过好几类坑——
 *   · 包用符号链接装进去，引擎静默不激活；
 *   · patch 里用 /^- id:/ 匹配缩进条目，漏匹配后重复插入，DSH 报重复 id；
 *   · 装完不核对，配置没生效也照样打印 done；
 *   · 出错时半装状态留在 profile 里，下次装更难查。
 * 所以这里每一步都「做 → 验 → 不行就回滚」，任何一步失败都恢复到装之前。
 *
 * 用法：
 *   node scripts/setup.mjs                  # 自动找 profile（只有一个就直接用）
 *   node scripts/setup.mjs --profile web
 *   node scripts/setup.mjs --dry-run        # 只打印要做什么，不写盘
 *   node scripts/setup.mjs --verify-only    # 只检查现有安装，不修改
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = 'dsh-fish-jiyu'

// —— 参数 ——————————————————————————————————————————————
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback = '') => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const DRY = flag('dry-run')
const VERIFY_ONLY = flag('verify-only')

const say = (tag, text) => console.log(`${tag} ${text}`)
const ok = (text) => say('  ok', text)
const info = (text) => say('  ..', text)
const plan = (text) => say('  ->', text)
const bad = (text) => say('  !!', text)

/** 找一个可用的 profile。 */
function resolveProfile() {
  const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
  const given = value('profile', process.env.PROFILE ?? '')
  const root = path.join(home, 'profiles')
  if (given !== '') {
    const dir = path.join(root, given)
    if (!existsSync(path.join(dir, 'package.json'))) throw new Error(`profile 不存在或没有 package.json：${dir}`)
    return dir
  }
  if (!existsSync(root)) throw new Error(`没找到 profiles 目录：${root}`)
  const found = readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')))
  if (found.length === 1) return found[0]
  if (found.length === 0) throw new Error(`${root} 下面没有可用的 profile`)
  throw new Error(`有多个 profile，请用 --profile 指定：${found.map((d) => path.basename(d)).join(', ')}`)
}

// —— patch 文本的读写：只按行结构处理，不靠正则猜缩进 ————————————

/** 把 patch 切成行；保留原换行符，写回时原样拼。 */
const linesOf = (text) => String(text ?? '').split('\n')

/**
 * 找到某个 id 的条目范围。**只在缩进 0 的 `- id:` 上匹配**——
 * 这正是 11-22 那次重复插入的根源：用 /^- id:/ 去匹配缩进过的行，漏了。
 * @returns `{ start, end }`（end 不含）或 null。
 */
export function findRow(lines, id) {
  const start = lines.findIndex((line) => new RegExp(`^-\\s*id:\\s*${id}\\s*$`).test(line))
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^-\s/.test(lines[end])) end += 1
  return { start, end }
}

/** 读出条目里缩进为两格的 `key: value`。 */
export function rowValues(lines, row) {
  const out = {}
  for (const line of lines.slice(row.start, row.end)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (m !== null) out[m[1]] = m[2].trim()
  }
  return out
}

/** 给条目设置 `disabled: true`；没有就加到 id 行下面。 */
export function setDisabled(lines, id, disabled = true) {
  const row = findRow(lines, id)
  if (row === null) return { changed: false, reason: 'no-row' }
  const current = rowValues(lines, row)
  if (current.disabled === String(disabled)) return { changed: false, reason: 'already' }
  const disabledAt = lines.slice(row.start, row.end).findIndex((line) => /^ {2}disabled:/.test(line))
  if (disabledAt >= 0) {
    lines[row.start + disabledAt] = `  disabled: ${disabled}`
  } else {
    lines.splice(row.start + 1, 0, `  disabled: ${disabled}`)
  }
  return { changed: true }
}

/** 整条删掉。 */
export function removeRow(lines, id) {
  const row = findRow(lines, id)
  if (row === null) return false
  lines.splice(row.start, row.end - row.start)
  // 顺手收掉多余空行
  while (row.start < lines.length && lines[row.start].trim() === '' && (row.start === 0 || lines[row.start - 1].trim() === '')) lines.splice(row.start, 1)
  return true
}

/** 结构自检：重复 id 会让 DSH 报冲突，缩进错会让条目静默失效。 */
export function validatePatch(text) {
  const lines = linesOf(text)
  const ids = new Map()
  const problems = []
  // 三种行：顶层 `- id:`、顶层 `- insert:`、以及它们下面的缩进字段。
  // insert 块里只看「直接子条目」，更深层的插件 id 属于 preset 内部，允许重名。
  let block = null
  let insertIndent = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      const topId = /^- id:\s*(\S+)\s*$/.exec(line)
      if (topId !== null) {
        ids.set(topId[1], (ids.get(topId[1]) ?? 0) + 1)
        block = 'top'
        insertIndent = null
        continue
      }
      if (/^- insert:\s*$/.test(line)) {
        block = 'insert'
        insertIndent = null
        continue
      }
      block = null
      problems.push(`第 ${i + 1} 行不是条目：${line.slice(0, 40)}`)
      continue
    }
    const childId = /^- id:\s*(\S+)\s*$/.exec(line.trimStart())
    if (block === 'insert' && childId !== null) {
      if (insertIndent === null) insertIndent = indent
      if (indent === insertIndent) ids.set(childId[1], (ids.get(childId[1]) ?? 0) + 1)
      continue
    }
    if (block === null) problems.push(`第 ${i + 1} 行缩进但不在条目块里：${line.slice(0, 40)}`)
  }
  for (const [id, count] of ids) if (count > 1) problems.push(`id 重复 ${count} 次：${id}`)
  return { problems, ids }
}

// —— 复制 ——————————————————————————————————————————————

const COPY_EXCLUDES = new Set(['node_modules', '.git', 'loaded.txt', 'load-error.txt', 'test'])

function copyPackage(from, to) {
  // 2026-11-28 修：从 profile 自己的 local-packages 副本跑 setup 时，from 和 storeCopy 是同一个路径。
  // 旧版先 rm(to) 再 cp(from)，等于把源目录清空后再复制自己；实测目录被清成 0 项。
  if (path.resolve(from) === path.resolve(to)) {
    info(`源与目标相同，跳过复制：${from}`)
    return
  }
  if (existsSync(to)) {
    const stat = lstatSync(to)
    if (stat.isSymbolicLink()) {
      rmSync(to)
      info('原来是指向别处的符号链接，已删除（符号链接会让引擎静默不激活）')
    } else {
      rmSync(to, { recursive: true, force: true })
    }
  }
  mkdirSync(to, { recursive: true })
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src)
      if (COPY_EXCLUDES.has(base)) return false
      if (/\.bak-/.test(base) || base.endsWith('.tgz')) return false
      return true
    },
  })
}

// —— 主流程 ——————————————————————————————————————————————

function main() {
  const profileDir = resolveProfile()
  const pkgPath = path.join(profileDir, 'package.json')
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const storeCopy = path.join(profileDir, 'local-packages', PKG_NAME)
  const target = path.join(profileDir, 'node_modules', PKG_NAME)
  // 回滚时要知道这个目录是不是这次才建的
  const targetExisted = existsSync(target)
  const storeExisted = existsSync(storeCopy)

  console.log(`\n鲫鱼 ${JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8')).version} · ${profileDir}${DRY ? '（dry-run，不写盘）' : ''}\n`)

  // 0) 前置检查
  info('前置检查')
  const srcIndex = path.join(HERE, 'index.js')
  if (!existsSync(srcIndex)) throw new Error(`包不完整：缺 ${srcIndex}`)
  const originalPkg = readFileSync(pkgPath, 'utf8')
  const originalPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : null
  ok(`node ${process.version}`)
  ok(`源包 ${path.basename(HERE)}`)

  if (VERIFY_ONLY) {
    const problems = verify({ profileDir, pkgPath, target, patchPath })
    if (problems.length > 0) {
      bad(`${problems.length} 项有问题`)
      process.exit(1)
    }
    console.log('\n现有安装没问题。\n')
    return
  }

  // 1) 备份（失败要能还原，所以先记在内存里，同时落一份文件）
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  if (!DRY) {
    writeFileSync(`${pkgPath}.bak-${stamp}`, originalPkg)
    if (originalPatch !== null) writeFileSync(`${patchPath}.bak-${stamp}`, originalPatch)
  }
  info(`备份 package.json${originalPatch === null ? '' : '、cordis.patch.yml'} → *.bak-${stamp}`)

  try {
    // 2) 复制成真目录（不走符号链接）
    if (DRY) {
      plan(`复制到 ${storeCopy} 和 ${target}`)
    } else {
      copyPackage(HERE, storeCopy)
      copyPackage(HERE, target)
      ok(`复制完成 → ${path.relative(profileDir, target)}`)
    }

    // 3) package.json：依赖 + bundle 条目
    const pkg = JSON.parse(originalPkg)
    pkg.dependencies = { ...(pkg.dependencies ?? {}) }
    const dep = `link:${storeCopy.replace(/\\/g, '/')}`
    if (pkg.dependencies[PKG_NAME] !== dep) {
      pkg.dependencies[PKG_NAME] = dep
      plan('package.json：写依赖 dsh-fish-jiyu')
    }
    pkg.dsh = { ...(pkg.dsh ?? {}) }
    pkg.dsh.profile = { ...(pkg.dsh.profile ?? {}) }
    const bundles = Array.isArray(pkg.dsh.profile.bundles) ? [...pkg.dsh.profile.bundles] : []
    if (!bundles.includes(PKG_NAME)) {
      const at = bundles.indexOf('dsh-compaction-vcc')
      if (at < 0) bundles.push(PKG_NAME)
      else bundles.splice(at + 1, 0, PKG_NAME)
      pkg.dsh.profile.bundles = bundles
      plan(`package.json：bundle 加在 ${at < 0 ? '末尾' : 'dsh-compaction-vcc 之后'}`)
    }
    if (!DRY) writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

    // 4) cordis.patch.yml
    if (originalPatch === null) {
      info('没有 cordis.patch.yml：跳过（条目由 bundle 提供）')
    } else {
      const lines = linesOf(originalPatch)
      if (lines.length < 5) info('cordis.patch.yml 很短，按原文处理')
      // 4a) 旧的压缩引擎让位
      for (const id of ['compaction-vcc', 'compaction-basic']) {
        const result = setDisabled(lines, id, true)
        if (result.changed) plan(`patch：${id} → disabled: true`)
      }
      // 4b) compaction-jiyu：**不要动**。bundle 用 `- insert:` 建这条，profile 里
      //     的 `- id: compaction-jiyu` 是给它打配置补丁（thresholdRatio 等），
      //     删掉就等于把主人的配置清空。2026-11-25 我在真机上删过一次，靠备份救回。
      // 4c) 旧剪裁阈值撤销
      const cleared = clearPruner(lines)
      if (cleared) plan('patch：撤掉 2000/1200/500，回到宿主默认 8192')

      const next = lines.join('\n')
      const check = validatePatch(next)
      if (check.problems.length > 0) throw new Error(`patch 结构不对：${check.problems.join('；')}`)
      if (!DRY && next !== originalPatch) writeFileSync(patchPath, next)
      ok(`patch 有效（${check.ids.size} 条）`)
    }

    // 5) 装完必须核对，不能只看「写进去了」
    if (!DRY) {
      const problems = verify({ profileDir, pkgPath, target, patchPath, quiet: true })
      if (problems.length > 0) throw new Error(`装完自检失败：${problems.join('；')}`)
    }
    console.log('\n完成。重启 DSH 生效。\n')
  } catch (error) {
    // 6) 回滚：一步失败就把两份文件还原，不留半装状态
    if (!DRY) {
      if (!targetExisted) rmSync(target, { recursive: true, force: true })
      if (!storeExisted) rmSync(storeCopy, { recursive: true, force: true })
      writeFileSync(pkgPath, originalPkg)
      if (originalPatch !== null) writeFileSync(patchPath, originalPatch)
      bad(`失败：${error.message}`)
      bad('已还原 package.json' + (originalPatch === null ? '' : ' 和 cordis.patch.yml'))
    } else {
      bad(`失败：${error.message}`)
    }
    process.exit(1)
  }
}

/** 撤销我们写过、后来判定没必要的剪裁阈值（只撤原样匹配的三项）。 */
function clearPruner(lines) {
  const row = findRow(lines, 'tool-result-pruner')
  if (row === null) return false
  // 阈值写在 config: 下面（缩进 4 格），rowValues 只看两格，所以这里自己扫一遍。
  const values = {}
  for (const line of lines.slice(row.start, row.end)) {
    const m = /^\s+(thresholdChars|headChars|tailChars):\s*(\d+)\s*$/.exec(line)
    if (m !== null) values[m[1]] = m[2]
  }
  const legacy = values.thresholdChars === '2000' && values.headChars === '1200' && values.tailChars === '500'
  if (!legacy) return false
  const kept = lines.slice(row.start, row.end).filter((line) => !/^ {2,4}(thresholdChars|headChars|tailChars):/.test(line))
  const configAt = kept.findIndex((line) => /^ {2}config:\s*$/.test(line))
  if (configAt >= 0 && kept.slice(configAt + 1).every((line) => line.trim() === '' || line.trim().startsWith('#'))) {
    kept.splice(configAt, kept.length - configAt)
  }
  lines.splice(row.start, row.end - row.start, ...kept)
  // 收尾留一个空行，免得和下一条黏在一起（YAML 合法但难读）
  const after = lines[row.start + kept.length]
  if (after !== undefined && after.trim() !== '') lines.splice(row.start + kept.length, 0, '')
  return true
}

/** 核对现有安装；返回问题清单（空数组 = 通过）。 */
function verify({ profileDir, pkgPath, target, patchPath, quiet = false }) {
  const problems = []
  const check = (name, fn) => {
    try {
      const detail = fn()
      if (!quiet) ok(`${name}${detail === undefined ? '' : `：${detail}`}`)
    } catch (error) {
      problems.push(`${name}（${error.message}）`)
      if (!quiet) bad(`${name}：${error.message}`)
    }
  }

  check('package.json 可解析', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (!pkg.dependencies?.[PKG_NAME]) throw new Error('没有 dsh-fish-jiyu 依赖')
    if (!Array.isArray(pkg.dsh?.profile?.bundles) || !pkg.dsh.profile.bundles.includes(PKG_NAME)) throw new Error('bundle 列表里没有 dsh-fish-jiyu')
    return `${pkg.dsh.profile.bundles.length} 个 bundle`
  })

  check('包是真目录', () => {
    if (!existsSync(target)) throw new Error('node_modules 里没有这个包')
    if (lstatSync(target).isSymbolicLink()) throw new Error('是符号链接，引擎会静默不激活')
    const version = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).version
    if (!existsSync(path.join(target, 'index.js'))) throw new Error('缺 index.js')
    return `v${version}`
  })

  check('入口语法', () => {
    const { execFileSync } = require('node:child_process')
    execFileSync(process.execPath, ['--check', path.join(target, 'index.js')])
    return 'node --check 通过'
  })

  // 2026-11-27：引擎和编译器都搬进本包了（lib/engine/、lib/compiler/），
  // 装完必须能真的 import 起来——「外壳加载、引擎静默不激活」就是这里没查。
  check('引擎与编译器文件齐全', () => {
    const required = [
      'lib/engine/base.js', 'lib/engine/api.js', 'lib/engine/region.js',
      'lib/compiler/render.js', 'lib/compiler/tokens.js', 'lib/compiler/checkpoint.js', 'lib/host.js',
    ]
    for (const rel of required) if (!existsSync(path.join(target, rel))) throw new Error(`缺 ${rel}`)
    if (existsSync(path.join(target, 'lib/vcc'))) throw new Error('还有 lib/vcc（0.4.29 起已删除）')
    return `${required.length} 个文件`
  })

  check('引擎能加载', () => {
    // 只有 profile 里装了宿主包（@deepseek-ai/*）时这条才有意义；
    // 临时 profile / 纯包管理场景没有宿主，跳过而不是误报。
    if (!existsSync(path.join(profileDir, 'node_modules', '@deepseek-ai'))) return '跳过（该 profile 没有宿主包）'
    const { execFileSync } = require('node:child_process')
    const script = `await import(${JSON.stringify(path.join(target, 'lib/engine/base.js'))}); console.log('ok')`
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15000 })
    if (!out.includes('ok')) throw new Error('import 没跑通')
    return 'import 通过（宿主包可解析）'
  })

  check('patch 结构', () => {
    if (!existsSync(patchPath)) return '没有 patch 文件（用 bundle 默认）'
    const result = validatePatch(readFileSync(patchPath, 'utf8'))
    if (result.problems.length > 0) throw new Error(result.problems.join('；'))
    return `${result.ids.size} 条`
  })

  if (!quiet && problems.length === 0) info('自检全部通过')
  return problems
}

if (process.argv[1] && process.argv[1].endsWith('setup.mjs')) {
  try {
    main()
  } catch (error) {
    bad(error.message)
    process.exit(1)
  }
}
