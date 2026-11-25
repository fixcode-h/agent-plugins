import type { UeProject } from '../../types.ts'
import { t } from '../../util.ts'

/**
 * 编辑器没开时能直接读文件回答的操作（接口 + 注册表）：一个操作一个处理函数，返回和 UELink 同名操作同一个形状，
 * 多带 offline: true 和 note（读法的限制），instance 写 { kind: 'file' }，网页和 Agent 工具不用分两套。
 * 处理函数读不了（不是资源文件、引擎版本不认识、要的东西文件里没有）就抛 OfflineReadError，ops.ts 改走 UE。
 */
export interface OfflineCall {
  project: UeProject
  args: Record<string, unknown>
}

export type OfflineHandler = (call: OfflineCall) => Promise<Record<string, unknown>>

const handlers = new Map<string, { run: OfflineHandler; when?: (args: Record<string, unknown>) => boolean }>()

/** when：只有这类参数才离线读（例如 bp.graph 只有不按节点取详情时） */
export function registerOffline(op: string, run: OfflineHandler, when?: (args: Record<string, unknown>) => boolean) {
  handlers.set(op, { run, when })
}

export const canOffline = (op: string, args: Record<string, unknown>) => {
  const h = handlers.get(op)
  return !!h && (!h.when || h.when(args))
}

/** 共用的限制说明：读属性的操作自己再说默认值补得怎么样（defaults/resolve.ts 的 layerNote） */
export const offlineNote = () => t('编辑器没开，直接从磁盘上的文件读：不能修改，没有编译状态和没保存的改动')

export async function runOffline(op: string, call: OfflineCall): Promise<Record<string, unknown>> {
  const h = handlers.get(op)
  if (!h) throw new Error(`no offline handler: ${op}`)
  const res = await h.run(call)
  return {
    ...res,
    offline: true,
    note: [res.note, offlineNote()].filter(Boolean).join('；'),
    instance: { pid: 0, kind: 'file' },
  }
}
