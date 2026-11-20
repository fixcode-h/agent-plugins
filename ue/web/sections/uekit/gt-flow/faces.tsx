import type { LucideIcon } from 'lucide-react'
import { loopModeOf, walkChecks, countChecks, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { blockUi, TONE_TEXT } from '../gt-blocks/index.ts'
import { stepTitle } from '../gt-step-title.ts'
import { selectorLabel } from '../gt-selector-label.ts'
import { wholeScreenOf } from '../gt-selector-tree.ts'
import type { GtCloseHow, GtRef } from '../../../../shared/gt-script/ref/types.ts'
import { closeHowText } from '../gt-ref/CloseHowList.tsx'
import { describeRef, identText, targetText } from '../gt-ref/describe.ts'

/**
 * 流程图节点上一步「长什么样」：图标、标题、标题下的一行小字（定稿效果图 1、6）。
 * 一种动作一项，登记在表里；没登记的（click、key、wait…原有动作）用步骤列表同一套图标和一句中文（stepTitle）。
 * 场景里写了 note 的，标题一律用 note（AI 整理、人写的说明比自动拼的好懂）
 */
export interface StepFace {
  title: (s: GtStep) => string
  /** 标题下的一行：选择器、次数、脚本路径这类细节，等宽字显示 */
  sub?: (s: GtStep) => string
  /** 内容区一行一项的条件（如果、当…时、直到…）：有多项时都列出来 */
  lines?: (s: GtStep) => FaceLine[]
}

const table = new Map<string, StepFace>()
export const registerFace = (action: string, face: StepFace) => void table.set(action, face)

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const lastSeg = (sel: string) => wholeScreenOf(sel) ?? sel.split(/[/>]/).filter(Boolean).pop() ?? sel
// v4 的落点是 {obj, part}：节点上写「对象 › 部件」；旧选择器照旧
const sel = (v: unknown) => (typeof v === 'string' ? selectorLabel(v) : targetText(v))

/** 一项检查的一句话：目标和判断（取反的前面写「不是」） */
function checkText(c: Record<string, unknown>, neg: boolean) {
  // 对象的属性（v4）：对象 › 属性 比较
  if ('obj' in c)
    return `${neg ? t('不是') + ' ' : ''}${typeof c.obj === 'string' ? c.obj : describeRef(c.obj as GtRef)} ${identText(c as { prop?: string })}`
  const target = str(c.target) || str(c.value) || str(c.api) || str(c.expr)
  const what = Object.keys(c).find((k) => k !== 'target' && k !== 'settleMs') ?? ''
  return `${neg ? t('不是') + ' ' : ''}${lastSeg(target)}${what ? ` · ${what}` : ''}`
}

/** 条件的一句话：第一项的目标和判断，多项时写「等 N 项」 */
export function condText(cond: unknown): string {
  if (!cond || typeof cond !== 'object') return ''
  if (typeof (cond as { expr?: unknown }).expr === 'string') return (cond as { expr: string }).expr
  let first = ''
  walkChecks(cond, (c, _p, neg) => {
    if (!first) first = checkText(c, neg)
  })
  const n = countChecks(cond)
  return n > 1 ? t('{a} 等 {n} 项', { a: first, n }) : first
}

/** 节点内容区的一行：join 是和上一行怎么连（且 / 或），第一行没有 */
export interface FaceLine {
  join?: string
  text: string
}

/** 节点上最多列几项条件，再多的折成「还有 N 项」（节点不能无限长） */
export const MAX_LINES = 5

/** 条件拆成一行一项（节点内容区用）：条件可能有好几项，都列出来，「且 / 或」看它所在的组 */
export function condLines(cond: unknown): FaceLine[] {
  if (!cond || typeof cond !== 'object') return []
  if (typeof (cond as { expr?: unknown }).expr === 'string') return [{ text: (cond as { expr: string }).expr }]
  const out: FaceLine[] = []
  walkChecks(cond, (c, p, neg) => {
    const i = p[p.length - 1]
    const group = p[p.length - 2]
    const join = out.length && typeof i === 'number' && i > 0 ? (group === 'any' ? t('或') : t('且')) : undefined
    out.push({ join, text: checkText(c, neg) })
  })
  if (out.length <= MAX_LINES) return out
  return [...out.slice(0, MAX_LINES - 1), { text: t('还有 {n} 项', { n: out.length - MAX_LINES + 1 }) }]
}

registerFace('group', {
  title: (s) => str(s.name) || t('子图'),
})
registerFace('loop', {
  title: (s) => {
    const mode = loopModeOf(s)
    if (mode === 'times') return t('重复 {n} 次', { n: String(s.times) })
    if (mode === 'each') return t('对 {w} 的每个条目', { w: lastSeg(str(s.each)) })
    if (mode === 'in') return t('对每个值')
    if (mode === 'while') return t('当 {c} 时', { c: condText(s.while) })
    return t('直到 {c}', { c: condText(s.until) })
  },
  sub: (s) => (typeof s.max === 'number' ? t('最多 {n} 次', { n: s.max }) : ''),
  lines: (s) => {
    const mode = loopModeOf(s)
    return mode === 'while' ? condLines(s.while) : mode === 'until' ? condLines(s.until) : []
  },
})
registerFace('if', {
  title: (s) => (s.branch === 'state' ? t('按状态分支') : t('如果 {c}', { c: condText(s.cond) })),
  sub: (s) => (s.branch === 'state' ? condText(s.cond) : ''),
  lines: (s) => condLines(s.cond),
})
registerFace('call', {
  title: (s) => str(s.name) || lastSeg(str(s.script)) || t('子图'),
  sub: (s) => str(s.script),
})
registerFace('set', {
  title: (s) => t('设变量 {v}', { v: str(s.var) }),
  sub: (s) => (s.value === undefined ? '' : JSON.stringify(s.value)),
})
registerFace('obj.call', {
  title: (s) => t('调函数 {f}', { f: str(s.function) }),
  sub: (s) => (s.obj ? targetText({ obj: s.obj, part: s.part }) : ''),
})
registerFace('api', { title: (s) => t('调接口 {a}', { a: str(s.api) }) })
registerFace('break', { title: () => t('跳出循环') })
registerFace('continue', { title: () => t('进下一轮') })
registerFace('return', { title: () => t('结束脚本') })
registerFace('fail', { title: (s) => str(s.message) || t('主动失败') })
registerFace('obj.close', {
  title: (s) => t('关闭 {w}', { w: targetText({ obj: s.obj }) }),
  sub: (s) => closeHowText(s.how as GtCloseHow[] | undefined),
})

export function faceOf(s: GtStep): {
  icon: LucideIcon
  tone: string
  title: string
  sub: string
  lines: FaceLine[]
} {
  const f = table.get(s.action)
  const note = str(s.note).trim()
  // 图标和色调取块 UI 注册表（gt-blocks），和列表视图、插入菜单同一张表，不在这里另配一套
  const ui = blockUi(s.action)
  const look = { icon: ui.icon, tone: TONE_TEXT[ui.tone] }
  if (!f) return { ...look, title: note || stepTitle(s), sub: sel(s.target), lines: [] }
  const lines = f.lines?.(s) ?? []
  // 只有一项条件、标题里已经写了它（没写 note）时，内容区不再重复一遍
  const dup = !note && lines.length === 1
  return { ...look, title: note || f.title(s), sub: f.sub?.(s) ?? '', lines: dup ? [] : lines }
}

/** 守护一行的左半「当 …」和右半「做 …」 */
export function guardFace(g: { name?: string; when?: unknown; do?: GtStep[] }) {
  const steps = Array.isArray(g.do) ? g.do : []
  const first = steps[0]
  return {
    when: str(g.name) || condText(g.when),
    whenSub: str(g.name) ? condText(g.when) : '',
    act: first ? faceOf(first).title : t('（还没写要做什么）'),
    actSub: steps.length > 1 ? t('共 {n} 步', { n: steps.length }) : first ? faceOf(first).sub : '',
  }
}
