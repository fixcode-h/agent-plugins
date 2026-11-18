import type { CondNode, GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'

/** 一条路：条件 + 步骤。最后的「其余情况」没有条件 */
export interface Way {
  cond?: unknown
  then: GtStep[]
}

export const waysOf = (s: GtStep): Way[] => [
  { cond: s.cond, then: (s.then as GtStep[]) ?? [] },
  ...(Array.isArray(s.elif) ? (s.elif as Way[]) : []),
]

/** 路的数组写回 if / elif（至少一条有条件的路） */
export function withWays(s: GtStep, list: Way[]): GtStep {
  const [first, ...rest] = list
  const out: GtStep = { ...s, cond: first?.cond ?? { all: [] }, then: first?.then ?? [] }
  if (rest.length) out.elif = rest
  else delete out.elif
  return out
}

/** 抓到的控件种类（gt.inspect 的 kind）：一键分路先给最常用的那种分法 */
export type WidgetKind = 'button' | 'check' | 'text' | 'other'

export interface StatePreset {
  id: 'click' | 'shown' | 'text' | 'checked'
  label: string
  ways: CondNode[]
  rest: boolean
}

/**
 * 一键分路的几种分法（定稿 9.4A）：按控件给出常用的几条路，每条路的条件都是完整的条件组，之后可以随便改。
 * 反面的路（不显示、其余情况）由执行器按 elseSettleMs 稳住再走
 */
export const statePresets = (target: string): StatePreset[] => [
  {
    id: 'click',
    label: t('能点 / 显示但不能点 / 其余'),
    ways: [
      { target, enabled: true },
      {
        all: [
          { target, visible: true },
          { target, enabled: false },
        ],
      },
    ],
    rest: true,
  },
  { id: 'shown', label: t('显示 / 不显示'), ways: [{ target, visible: true }], rest: true },
  { id: 'text', label: t('文字是 … / 其余'), ways: [{ target, text: '' }], rest: true },
  { id: 'checked', label: t('勾上 / 没勾'), ways: [{ target, checked: true }], rest: true },
]

/** 按控件种类挑默认分法：按钮 → 能点…，勾选框 → 勾上 / 没勾，文字 → 文字是…，其余 → 显示 / 不显示 */
export function presetFor(target: string, kind?: WidgetKind): StatePreset {
  const id = kind === 'button' ? 'click' : kind === 'check' ? 'checked' : kind === 'text' ? 'text' : 'shown'
  return statePresets(target).find((p) => p.id === id)!
}

/** 换成这种分法：不丢步骤，新的第 k 条路接着用原来第 k 条路的步骤，多出来的有步骤的旧路留在后面；画成按状态分支 */
export function applyPreset(step: GtStep, p: StatePreset): GtStep {
  const list = waysOf(step)
  const fresh = p.ways.map((c, k) => ({ cond: c, then: list[k]?.then ?? [] }))
  const left = list.slice(p.ways.length).filter((w) => w.then.length)
  const next = withWays({ ...step, branch: 'state' }, [...fresh, ...left])
  if (p.rest) next.else = (step.else as GtStep[]) ?? []
  return next
}
