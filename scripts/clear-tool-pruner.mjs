#!/usr/bin/env node
/**
 * 把宿主的 tool-result-pruner 恢复成默认（去掉我们以前设的 2000/1200/500）。
 *
 * 为什么要撤：2026-11-24 我们以为剪裁发生在「工具结果进上下文之前」，把阈值
 * 从宿主的 8192 调到 2000。2026-11-25 读源码才发现：剪裁只在**压缩判定**时
 * 调用一次，不是每轮都剪；实测当前窗口只省 11.3% 字符，却会把超过 2000 的
 * 输出剪掉中间段。收益远小于代价，主人决定去掉。
 *
 * 这个脚本只做一件事：如果 profile 里那条 tool-result-pruner 的 config 正好
 * 是我们当年写的三项，就把它删掉（回到宿主默认 8192，对我们几乎不触发）。
 * 它**不会**主动设置任何阈值，也不碰别人的自定义值。
 *
 * 用法：node scripts/clear-tool-pruner.mjs [profile 目录]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/** 我们当年写进去的三项，只有原样匹配才撤。 */
const LEGACY = { thresholdChars: 2000, headChars: 1200, tailChars: 500 }

/**
 * 纯函数：把文本里的旧阈值撤掉。给测试用，也方便以后在别处调。
 * @param text - cordis.patch.yml 的内容。
 * @returns 处理后的文本（没匹配到就原样返回）。
 */
export function clearPrunerOverride(text) {
  const lines = String(text ?? '').split('\n')
  const start = lines.findIndex((line) => /^-\s*id:\s*tool-result-pruner\s*$/.test(line.trim()))
  if (start < 0) return { text: String(text ?? ''), changed: false, reason: 'no-row' }
  // 条目到下一个 "- id:" 或文件尾
  let end = start + 1
  while (end < lines.length && !/^\s*-\s*id:/.test(lines[end])) end += 1
  const block = lines.slice(start, end)
  const got = {}
  for (const line of block) {
    const m = /^\s+(thresholdChars|headChars|tailChars):\s*(\d+)\s*$/.exec(line)
    if (m !== null) got[m[1]] = Number(m[2])
  }
  const matches = Object.keys(LEGACY).every((key) => got[key] === LEGACY[key]) && Object.keys(got).length === 3
  if (!matches) {
    const reason = Object.keys(got).length === 0 ? 'already-default' : 'custom-values'
    return { text: String(text ?? ''), changed: false, reason, got }
  }
  const kept = block.filter((line) => !/^\s+(thresholdChars|headChars|tailChars):\s*\d+\s*$/.test(line))
  // config: 后面没内容了就一并去掉
  const configIndex = kept.findIndex((line) => /^\s*config:\s*$/.test(line))
  if (configIndex >= 0 && kept.slice(configIndex + 1).every((line) => line.trim() === '' || line.trim().startsWith('#'))) {
    kept.splice(configIndex, kept.length - configIndex)
  }
  return { text: [...lines.slice(0, start), ...kept, ...lines.slice(end)].join('\n'), changed: true, reason: 'cleared' }
}

const profileDir = process.argv[2] ?? path.join(process.env.DSH_HOME ?? path.join(process.env.HOME ?? '.', '.dsh'), 'profiles', 'web')
const file = path.join(profileDir, 'cordis.patch.yml')

function main() {
  if (!existsSync(file)) {
    console.log('pruner: 没有 cordis.patch.yml，跳过')
    return
  }
  const result = clearPrunerOverride(readFileSync(file, 'utf8'))
  if (result.changed) {
    writeFileSync(file, result.text)
    console.log('pruner: 已撤掉 2000/1200/500，回到宿主默认 8192（重启宿主生效）')
    return
  }
  const what = result.reason === 'already-default'
    ? '没有阈值配置（已是宿主默认 8192）'
    : result.reason === 'no-row'
      ? 'profile 里没有 tool-result-pruner 条目，用宿主默认（8192）'
      : `现有值 ${JSON.stringify(result.got)} 不是我们设的`
  console.log(`pruner: ${what}，不动`)
}

if (process.argv[1] && process.argv[1].endsWith('clear-tool-pruner.mjs')) main()
