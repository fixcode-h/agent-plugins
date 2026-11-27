import type { Check, Issue } from '../types.ts'
import { assertRun } from './assert-run.ts'
import { makeStyleCtx, type StyleRule } from './ctx.ts'
import { dupPrefix } from './dup-prefix.ts'
import { fixedWait } from './fixed-wait.ts'
import { flatLong } from './flat-long.ts'
import { libraryMatch } from './library-match.ts'
import { inlineLua, loopNoMax } from './misc.ts'
import { phaseSplit } from './phases.ts'
import { saveThenAssert } from './save-then-assert.ts'

/**
 * 写法建议：一条规则一个文件，在这里登记一行。只报 warning、不挡运行。
 * 起因：Agent 写的脚本一项一个节点（同一时刻的检查拆开、存变量再断言、复制准备步骤），见技能「写紧凑」一节。
 */
const rules: StyleRule[] = [
  fixedWait,
  saveThenAssert,
  assertRun,
  dupPrefix,
  libraryMatch,
  flatLong,
  inlineLua,
  loopNoMax,
  phaseSplit,
]

export function registerStyleRule(rule: StyleRule) {
  rules.push(rule)
}

export const style: Check = {
  name: 'style',
  summary:
    '写法建议：固定等待、存了变量只为断言、连着几步检查、和同目录脚本重复的开头、和公共库一样的一段、长脚本不分段、塞 Lua 代码、循环没上限、准备和收尾写进了执行段',
  async run(env) {
    const c = makeStyleCtx(env)
    const out: Issue[] = []
    for (const r of rules) out.push(...(await r.run(c)))
    return out
  },
}
