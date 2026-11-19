import { createContext, useContext } from 'react'
import type { GtStep } from '../../../../../shared/gt-script/index.ts'
import { emptyRun, type FlowRunState } from '../run-state.ts'
import type { BpAt, BpGraph } from './graph.ts'

/**
 * 蓝图画布的节点、连线共用的东西：经上下文给，不塞进每个节点的 data（运行中只有状态在变，节点数据不变就不用重排）
 */
export interface BpCtx {
  run: FlowRunState
  editable: boolean
  /** 连着线的引脚：`节点 key:引脚 id`（输入引脚是 `节点 key:in`），没连的引脚画成空心圈 */
  linked: Set<string>
  /** 选中的节点 key */
  selected?: string
  /** 断开这个引脚后面那串（Alt 点引脚、连线上的 ✕） */
  disconnect: (at: BpAt) => void
  /** 在连线上插入：带步骤（拖到连线上的）直接插，不带时弹节点菜单 */
  insertAt: (at: BpAt, steps?: GtStep[], anchor?: { x: number; y: number }) => void
  /** 改注释框的字（undefined 是删掉） */
  editNote: (id: string, text: string | undefined) => void
}

export const BpContext = createContext<BpCtx>({
  run: emptyRun(),
  editable: false,
  linked: new Set(),
  disconnect: () => undefined,
  insertAt: () => undefined,
  editNote: () => undefined,
})

export const useBp = () => useContext(BpContext)

/** 连着线的引脚（上下文的 linked）：每条线的出发引脚和到达节点的输入引脚 */
export function linkedPins(g: BpGraph): Set<string> {
  const s = new Set<string>()
  for (const e of g.edges) {
    s.add(`${e.from}:${e.pin}`)
    s.add(`${e.to}:in`)
  }
  return s
}
