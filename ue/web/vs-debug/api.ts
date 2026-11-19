import { ppost } from '../api.ts'

/**
 * VS 调试的两个接口（服务端 server/vs-debug/）：
 * - p/<id>/vs-debug：{ op, args } 转给 UEToVS 的调试控制管道，op 就是协议里的操作名，回 { result } 或 { error }
 * - p/<id>/vs-debug/open-vs：用 VS 打开项目的 .sln 并等它就绪（可能要一两分钟）；into 是开着别的项目的 VS 的 PID，
 *   让那个 VS 换成这个项目，不给就用 vswhere 找到的 devenv 新开一个
 * 出错由 api.ts 的 unwrap 抛出来，界面原样显示
 */
export const vsOp = <T = unknown>(project: string, op: string, args: Record<string, unknown> = {}) =>
  ppost<{ result: T }>(project, 'vs-debug', { op, args }).then((r) => r.result)

export const openVs = (project: string, into?: number) =>
  ppost<{ ok: boolean }>(project, 'vs-debug/open-vs', into === undefined ? {} : { into })
