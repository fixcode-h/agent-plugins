import { issue, type Issue } from '../types.ts'
import { inRecorded, type StyleRule } from './ctx.ts'

/** 往脚本里直接塞 Lua 代码：逻辑散在脚本里没人维护，也绕过了接口库的只读检查 */
export const inlineLua: StyleRule = {
  name: 'inline-lua',
  run({ slots }) {
    const out: Issue[] = []
    for (const [slot, rows] of slots)
      for (const r of rows) {
        // gm.run 展开出来的 run 里本来就是 Gm.Lua，那是面板按 GM 库生成的
        if (/(^|\.)run(\.|$)/.test(slot) || inRecorded(r)) continue
        if (r.step.action === 'api' && r.step.api === 'Gm.Lua')
          out.push(
            issue(
              r,
              'style_inline_lua',
              '脚本里直接写 Lua 代码：把这段逻辑写成项目接口（GameTestApi 里的模块函数）再用 api 调；要执行项目已有的 GM 用 gm.run',
              'warning',
            ),
          )
      }
    return out
  },
}

/** Agent 写的 until / while 循环没给上限：条件写错就一直跑 */
export const loopNoMax: StyleRule = {
  name: 'loop-no-max',
  run({ slots }) {
    const out: Issue[] = []
    for (const rows of slots.values())
      for (const r of rows) {
        const s = r.step
        if (s.action !== 'loop' || inRecorded(r) || (s.until === undefined && s.while === undefined)) continue
        if (typeof s.max === 'number' && s.max > 0) continue
        if (typeof s.timeoutMs === 'number' && s.timeoutMs > 0) continue
        out.push(
          issue(
            r,
            'style_loop_no_max',
            '循环没有 max 也没有 timeoutMs：条件写错时会一直跑。按预计轮数的 3 倍以上给 max',
            'warning',
          ),
        )
      }
    return out
  },
}
