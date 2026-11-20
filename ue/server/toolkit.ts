import type { McpResult, McpToolEffect } from '../../sdk/server.ts'
import type { OpCtx } from './ops.ts'
import { jsonResult } from './json-result.ts'

/** 各个工具定义文件共用的小东西（tools.ts、tools-asset.ts） */
export const TARGET = {
  type: 'object',
  description:
    '目标进程和世界：instance 写 PID 或 editor / game / server / background，world 写 editor、pie0、pie1、game；不填用 UE 页上选的目标',
  properties: { instance: { type: ['string', 'number'] }, world: { type: 'string' } },
}

/** 给 Agent 的结果：对象是紧凑 JSON + structuredContent，超长按列表截短（json-result.ts）；字符串照旧 */
export const out = (data: unknown, max?: number) => jsonResult(data, max)
export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

export type Handler = (a: Record<string, unknown>, ctx: OpCtx) => Promise<McpResult>

/**
 * 工具对项目做什么（面板插件接口 3）：只有真正写磁盘的（ue_save）标 edit、编译（ue_compile）标 verify，
 * 其余都是只读或只改内存 / 运行时，不标——标成 edit 会让只读角色、Bug 先诊断阶段连读资源都被面板守卫挡住。
 * targets 按参数算要改的文件，root 是 UE 项目根目录
 */
export interface ToolEffect {
  effect?: McpToolEffect
  targets?: (a: Record<string, unknown>, root: string) => string[]
}

export function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  fn: Handler,
  extra: ToolEffect = {},
) {
  return { name, description, properties, required, fn, ...extra }
}
