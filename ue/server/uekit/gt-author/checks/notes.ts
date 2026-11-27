import { issue, type Check } from './types.ts'

/**
 * 每一步都要有名称和说明（用户 2026-11-27）：title 是很短的一句中文说这一步做什么，画布节点、运行记录、报告、
 * 对话里的运行卡片每行先显示它；note 是详细说明。只看 api / assert / wait 加技术细节看不出每步在做什么。
 * 只算警告不算错误：旧脚本和录制的脚本照样能跑，Agent 看到警告补上即可；两类各合成一条，免得几十步刷屏
 */
const MAX_LIST = 20

const blank = (v: unknown) => typeof v !== 'string' || !v.trim()

export const notes: Check = {
  name: 'notes',
  summary: '每一步有没有写 title（节点名称）和 note（详细说明）',
  run({ steps }) {
    const list = (pick: typeof steps) => {
      const names = pick.slice(0, MAX_LIST).map((s) => (typeof s.step.id === 'string' ? s.step.id : s.path))
      return `${names.join('、')}${pick.length > MAX_LIST ? ` 等 ${pick.length} 步` : ''}`
    }
    const noTitle = steps.filter((s) => blank(s.step.title))
    const noNote = steps.filter((s) => blank(s.step.note))
    const out = []
    if (noTitle.length)
      out.push(
        issue(
          noTitle.length === 1 ? noTitle[0] : undefined,
          'no_title',
          `这些步骤没写 title：${list(noTitle)}。每一步（含块）写一句很短的中文 title 说这一步做什么（例：「选第一个剧情选项」「等对白结束」），画布、运行记录、报告、对话卡片每行先显示它（要 GameTest 2.6.0 起）`,
          'warning',
        ),
      )
    if (noNote.length)
      out.push(
        issue(
          noNote.length === 1 ? noNote[0] : undefined,
          'no_note',
          `这些步骤没写 note：${list(noNote)}。note 写详细说明：这一步为什么这样做、准备的是什么状态、判断的依据`,
          'warning',
        ),
      )
    return out
  },
}
