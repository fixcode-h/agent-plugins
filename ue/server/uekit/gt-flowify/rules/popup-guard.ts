import { screenOf, widgetOf } from '../sig.ts'
import type { FlowHint, FlowRule, Step } from '../types.ts'

/**
 * 中途弹出、点一下就关掉的界面（公告、奖励、引导、确认框）：录制时碰巧弹了，回放时不一定弹，写死在主流程里会卡住。
 * 认法：一两步落在一个新界面上、前后都回到别的界面，并且点的像「关闭 / 确定 / 跳过」或界面名像弹窗。
 * 第一次出现的那几步改成守护（出现就做），后面再出现的同一弹窗直接删掉；在别的脚本里也会弹的，Agent 可以改成全局守护。
 */
const CLOSE = /close|cancel|confirm|ok\b|okay|skip|got_?it|know|back|exit|关闭|确定|跳过|知道|返回|取消/i
const POPUP = /notice|popup|pop_|tips?\b|dialog|guide|announce|reward|toast|confirm|alert|msgbox|message_?box|公告|弹窗|引导/i
const MAX_RUN = 2

const isAct = (s: Step) => ['click', 'key'].includes(String(s.action ?? ''))

export const popupGuard: FlowRule = {
  name: 'popup-guard',
  summary: '中途弹出又马上关掉的界面 → 守护',
  run({ steps, claimed }) {
    const runs = new Map<string, number[][]>()
    let i = 0
    while (i < steps.length) {
      const scr = screenOf(steps[i].target)
      let j = i + 1
      while (scr && j < steps.length && screenOf(steps[j].target) === scr) j++
      const before = i > 0 ? screenOf(steps[i - 1].target) : ''
      const after = j < steps.length ? screenOf(steps[j].target) : ''
      const seg = steps.slice(i, j)
      const looks = POPUP.test(scr) || seg.some((s) => CLOSE.test(widgetOf(s.target)))
      // 前后至少一边落在别的界面上（开头、结尾弹的也算），并且这段不是整份脚本的主界面
      if (scr && j - i <= MAX_RUN && looks && seg.every(isAct) && (before || after) && before !== scr && after !== scr) {
        const nums = Array.from({ length: j - i }, (_, k) => i + k + 1)
        if (!nums.some((n) => claimed.has(n))) runs.set(scr, [...(runs.get(scr) ?? []), nums])
      }
      i = j
    }
    const out: FlowHint[] = []
    for (const [scr, list] of runs) {
      // 整份脚本一半以上的步骤都在这个界面上：它是主界面，不是弹窗
      if (steps.filter((s) => screenOf(s.target) === scr).length * 2 > steps.length) continue
      const [first, ...rest] = list
      const restNums = rest.flat()
      const all = [...first, ...restNums]
      out.push({
        rule: 'popup-guard',
        what:
          `${scr} 是中途弹出、点一下就关的界面（第 ${first.join('、')} 步），改成守护：出现就关，不出现也不卡` +
          (rest.length ? `；后面又弹了 ${rest.length} 次，一起删掉` : '') +
          '。别的脚本里也会弹的话可以改成全局守护（global）',
        steps: all,
        changes: [
          {
            what: `${scr} 出现就关`,
            op: 'guard',
            steps: first,
            guard: { name: `关闭 ${scr}`, when: { target: `${scr}:.`, onScreen: true } },
          },
          ...(restNums.length ? [{ what: `同一个弹窗再次出现的步骤，守护会处理`, op: 'delete', steps: restNums }] : []),
        ],
      })
      all.forEach((n) => claimed.add(n))
    }
    return out
  },
}
