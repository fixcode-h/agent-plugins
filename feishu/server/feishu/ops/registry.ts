import { DATA_OPS } from './data.ts'
import { DOC_OPS } from './docs.ts'
import { DRIVE_OPS } from './drive.ts'
import type { OpDef } from './types.ts'

/** 飞书操作注册表：工具名 → 动作 → 定义。加能力只在 docs / drive / data 里加一条 */
export const OPS: OpDef[] = [...DOC_OPS, ...DRIVE_OPS, ...DATA_OPS]

export const findOp = (tool: string, action: string) => OPS.find((o) => o.tool === tool && o.action === action)

/** 一个工具的全部动作（按注册顺序） */
export const actionsOf = (tool: string) => OPS.filter((o) => o.tool === tool).map((o) => o.action)

/** 注册表里出现过的工具名（按注册顺序去重） */
export const toolNames = () => [...new Set(OPS.map((o) => o.tool))]
