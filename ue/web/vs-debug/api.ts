import { ppost } from '../api.ts'

/**
 * VS 调试的两个接口（服务端 server/vs-debug/）：
 * - p/<id>/vs-debug：{ op, args } 转给 UEToVS 的调试控制管道，op 就是协议里的操作名，回 { result } 或 { error }
 * - p/<id>/vs-debug/open-vs：VS 没开时用 vswhere 找到的 devenv 打开项目的 .sln 并等它就绪（可能要一两分钟）
 * 出错由 api.ts 的 unwrap 抛出来，界面原样显示
 */
export const vsOp = <T = unknown>(project: string, op: string, args: Record<string, unknown> = {}) =>
  ppost<{ result: T }>(project, 'vs-debug', { op, args }).then((r) => r.result)

export const openVs = (project: string) => ppost<{ ok: boolean }>(project, 'vs-debug/open-vs')
