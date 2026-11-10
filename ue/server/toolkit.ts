import type { McpResult } from '../../sdk/server.ts'
import type { OpCtx } from './ops.ts'
import { clip, mcpText } from './util.ts'

/** 各个工具定义文件共用的小东西（tools.ts、tools-asset.ts） */
export const TARGET = {
  type: 'object',
  description:
    '目标进程和世界：instance 写 PID 或 editor / game / server / background，world 写 editor、pie0、pie1、game；不填用 UE 页上选的目标',
  properties: { instance: { type: ['string', 'number'] }, world: { type: 'string' } },
}

export const out = (data: unknown) => mcpText(clip(typeof data === 'string' ? data : JSON.stringify(data, null, 1)))
export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

export type Handler = (a: Record<string, unknown>, ctx: OpCtx) => Promise<McpResult>

export function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  fn: Handler,
) {
  return { name, description, properties, required, fn }
}
