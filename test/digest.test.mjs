/**
 * 工具结果摘要的单元测试：只抽最像结论的一行，报错优先。
 */
import { resultDigest } from '../lib/linear.js'

let failures = 0
const run = (name, actual, expected) => {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`)
  if (!ok) failures += 1
}

run('空文本', resultDigest(''), '')
run('只有空白', resultDigest('  \n\t\n '), '')
run('单行', resultDigest('Created file'), 'Created file')
run('多行取末行', resultDigest('line one\nline two\nall done'), 'all done')
run('报错行优先于末行', resultDigest('start\nError: EPERM: operation not permitted\nfinished'), 'Error: EPERM: operation not permitted')
run('中文报错', resultDigest('开始\n失败：端口被占用\n结束'), '失败：端口被占用')
run('超长截断', resultDigest('x'.repeat(80)), `${'x'.repeat(47)}…`)
run('压平空白', resultDigest('a\nb   c'), 'b c')

const { resultDigest: again } = await import('../lib/linear.js')
run('模块可重复导入', typeof again, 'function')

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
