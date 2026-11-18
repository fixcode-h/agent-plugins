import { createContext, useContext } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import type { InsertAt } from './layout.ts'
import { emptyRun, type FlowRunState } from './run-state.ts'

/**
 * 画布节点、连线共用的东西（运行状态、能不能改、插入动作），经上下文给，不塞进每个节点的 data：
 * 运行中每来一条推送只有状态变，节点的布局数据不变，xyflow 不用重排
 */
export interface FlowCtx {
  run: FlowRunState
  editable: boolean
  selected?: string
  /** 折叠 / 展开一块 */
  toggle: (key: string) => void
  /** 在某处插入：带步骤（拖进来的）直接插，不带时由外壳弹插入菜单 */
  insertAt: (at: InsertAt, steps?: GtStep[]) => void
  addGuard?: () => void
}

export const FlowContext = createContext<FlowCtx>({
  run: emptyRun(),
  editable: false,
  toggle: () => undefined,
  insertAt: () => undefined,
})

export const useFlow = () => useContext(FlowContext)
