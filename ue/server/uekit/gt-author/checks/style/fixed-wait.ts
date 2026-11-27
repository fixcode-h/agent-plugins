import { issue, type Issue } from '../types.ts'
import { inRecorded, type StyleRule } from './ctx.ts'

/** 固定等几秒：慢机器上不够、快机器上白等，还测不出「等的那件事到底发生没有」 */
export const fixedWait: StyleRule = {
  name: 'fixed-wait',
  run({ slots }) {
    const out: Issue[] = []
    for (const rows of slots.values())
      for (const r of rows) {
        const s = r.step
        if (s.action !== 'wait' || inRecorded(r)) continue
        if (s.until !== 'seconds' && !(s.until === undefined && s.seconds !== undefined)) continue
        out.push(
          issue(
            r,
            'style_fixed_wait',
            `固定等 ${String(s.seconds ?? '?')} 秒：改成 wait until=cond（或 obj.wait）等到具体情况出现，条件就是你在等的那件事（界面出现、状态变成 X、第 N 回合结算）；超时没等到本身就是失败。只有游戏画面上两个操作之间确实没有信号可等时才用固定等待，并在 note 写明原因`,
            'warning',
          ),
        )
      }
    return out
  },
}
