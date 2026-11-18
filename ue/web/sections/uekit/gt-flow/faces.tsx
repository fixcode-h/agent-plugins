import type { LucideIcon } from 'lucide-react'
import { loopModeOf, walkChecks, countChecks, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { blockUi, TONE_TEXT } from '../gt-blocks/index.ts'
import { stepTitle } from '../gt-step-title.ts'
import { selectorLabel } from '../gt-selector-label.ts'
import { wholeScreenOf } from '../gt-selector-tree.ts'

/**
 * 流程图节点上一步「长什么样」：图标、标题、标题下的一行小字（定稿效果图 1、6）。
 * 一种动作一项，登记在表里；没登记的（click、key、wait…原有动作）用步骤列表同一套图标和一句中文（stepTitle）。
 * 场景里写了 note 的，标题一律用 note（AI 整理、人写的说明比自动拼的好懂）
 */
export interface StepFace {
  title: (s: GtStep) => string
  /** 标题下的一行：选择器、次数、脚本路径这类细节，等宽字显示 */
  sub?: (s: GtStep) => string
}

const table = new Map<string, StepFace>()
export const registerFace = (action: string, face: StepFace) => void table.set(action, face)

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const lastSeg = (sel: string) => wholeScreenOf(sel) ?? sel.split(/[/>]/).filter(Boolean).pop() ?? sel
const sel = (v: unknown) => selectorLabel(str(v))

/** 条件的一句话：第一项的目标和判断，多项时写「等 N 项」 */
export function condText(cond: unknown): string {
  if (!cond || typeof cond !== 'object') return ''
  if (typeof (cond as { expr?: unknown }).expr === 'string') return (cond as { expr: string }).expr
  let first = ''
  walkChecks(cond, (c, _p, neg) => {
    if (first) return
    const target = str(c.target) || str(c.value) || str(c.api) || str(c.expr)
    const what = Object.keys(c).find((k) => k !== 'target' && k !== 'settleMs') ?? ''
    first = `${neg ? t('不是') + ' ' : ''}${lastSeg(target)}${what ? ` · ${what}` : ''}`
  })
  const n = countChecks(cond)
  return n > 1 ? t('{a} 等 {n} 项', { a: first, n }) : first
}

registerFace('group', {
  title: (s) => str(s.name) || t('步骤段'),
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
})
registerFace('if', {
  title: (s) => (s.branch === 'state' ? t('按状态分支') : t('如果 {c}', { c: condText(s.cond) })),
  sub: (s) => (s.branch === 'state' ? condText(s.cond) : ''),
})
registerFace('call', {
  title: (s) => t('调用 {s}', { s: lastSeg(str(s.script)) }),
  sub: (s) => str(s.script),
})
registerFace('set', {
  title: (s) => t('设变量 {v}', { v: str(s.var) }),
  sub: (s) => (s.value === undefined ? '' : JSON.stringify(s.value)),
})
registerFace('invoke', {
  title: (s) => t('调函数 {f}', { f: str(s.function) }),
  sub: (s) => (typeof s.object === 'string' ? s.object : ''),
})
registerFace('api', { title: (s) => t('调接口 {a}', { a: str(s.api) }) })
registerFace('break', { title: () => t('跳出循环') })
registerFace('continue', { title: () => t('进下一轮') })
registerFace('return', { title: () => t('结束脚本') })
registerFace('fail', { title: (s) => str(s.message) || t('主动失败') })
registerFace('widget.close', {
  title: (s) => t('关掉 {w}', { w: lastSeg(str(s.target)) }),
})
registerFace('widget.call', {
  title: (s) => t('调界面函数 {f}', { f: str(s.function) }),
  sub: (s) => sel(s.target),
})

export function faceOf(s: GtStep): { icon: LucideIcon; tone: string; title: string; sub: string } {
  const f = table.get(s.action)
  const note = str(s.note).trim()
  // 图标和色调取块 UI 注册表（gt-blocks），和列表视图、插入菜单同一张表，不在这里另配一套
  const ui = blockUi(s.action)
  const look = { icon: ui.icon, tone: TONE_TEXT[ui.tone] }
  if (!f) return { ...look, title: note || stepTitle(s), sub: sel(s.target) }
  return { ...look, title: note || f.title(s), sub: f.sub?.(s) ?? '' }
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
