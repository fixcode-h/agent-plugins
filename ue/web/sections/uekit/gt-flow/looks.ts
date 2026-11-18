/**
 * 流程图画布特有的外观（协议第 14 节的「一种一个注册项」）：块在画布上画成什么框、要不要画「下一轮」回线。
 * 步骤的名字和图标不在这里（和列表视图共用）；结构（有哪些槽）只看数据层的 slotsOf，这里不重复。
 * 新加一种块时在这里登记一行，布局和节点都不用改
 */
export type FrameTone = 'group' | 'loop' | 'branch' | 'call'

export interface FlowLook {
  /** 框的色调：步骤段灰、循环青、分支琥珀 */
  tone: FrameTone
  /** 子步骤做完回到第一步（循环）：画一条虚线「下一轮」 */
  repeat?: boolean
}

const table = new Map<string, FlowLook>()

export const registerFlowLook = (action: string, look: FlowLook) => void table.set(action, look)

registerFlowLook('group', { tone: 'group' })
registerFlowLook('loop', { tone: 'loop', repeat: true })
registerFlowLook('if', { tone: 'branch' })
registerFlowLook('call', { tone: 'call' })

/** 没登记的块按步骤段画 */
export const flowLookOf = (action: string): FlowLook => table.get(action) ?? { tone: 'group' }
