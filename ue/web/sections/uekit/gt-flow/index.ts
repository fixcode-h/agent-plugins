/**
 * GameTest 流程图（定稿 9.1 / 9.2）。编辑页外壳把 GtFlowView 注册成「流程图」视图；
 * 布局（layout）、运行状态（run-state）是纯函数，节点、连线、外观各自一张注册表（nodes/、edges、looks、faces）
 */
export { GtFlowView, type FlowSelection, type GtFlowViewProps } from './GtFlowView.tsx'
export { useFlowRun } from './use-flow-run.ts'
export { GT_STEPS_MIME } from './dnd.ts'
export { registerFace, faceOf } from './faces.tsx'
export { registerFlowLook } from './looks.ts'
export type { InsertAt } from './layout.ts'
export type { FlowRunState } from './run-state.ts'
