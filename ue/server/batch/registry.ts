import type { OpCtx } from '../ops.ts'
import type { ReportStep } from './undo.ts'

/**
 * 能批量的工具动作（键是「工具.动作」，没有 action 的工具只写工具名）。加一个 = 在这里登记一项：
 * 对应的 UELink 操作、除 path 外的公共参数怎么拼、超时，以及每个资源做完后面板要记的东西（after）。
 * UELink 那边也要登记同名操作能批量（AgentPanelBridgeEditor.cpp 的 RegisterEditorBatchOps）
 */
export interface BatchEntry {
  /** UELink 操作名；按参数选的（ue_get 有没有 prop）写成函数 */
  op: string | ((a: Record<string, unknown>) => string)
  /** 公共参数（每个资源都一样的那些） */
  args: (a: Record<string, unknown>) => Record<string, unknown>
  timeoutMs: number
  /** 写操作：资源 + 演练 + 回滚的说明进汇总 */
  write?: boolean
  /** 每个资源的结果到了之后（编译结论交给写后编译钩子……） */
  after?: (ctx: OpCtx, steps: ReportStep[]) => void
}

const entries = new Map<string, BatchEntry>()

export function registerBatch(key: string, entry: BatchEntry) {
  entries.set(key, entry)
}

export function batchEntry(tool: string, action?: unknown) {
  return entries.get(action ? `${tool}.${action}` : tool) ?? entries.get(tool)
}

export function batchKeys() {
  return [...entries.keys()]
}
