import type { UeProject, VsBreakpoint, VsDebugState, VsDebugStatus } from '../types.ts'
import { t } from '../util.ts'
import { pipeCall } from './client.ts'
import { endpointOf, overridePath } from './connect.ts'
import { findSolution } from './discover.ts'
import { VsDebugError } from './protocol.ts'
import { findDevenv } from './vswhere.ts'

/**
 * UE 页「VS 调试」卡片的状态（projectState 的 vsDebug）。和其他状态一起刷新，所以整体限 1.5 秒：
 * VS 卡住时宁可这次显示「连不上」，也不拖慢整页状态。status 和 bp.list 在一个连接上连发，省一次握手
 */
export const STATE_BUDGET_MS = 1500

const budget = <T>(work: Promise<T>, ms: number, msg: () => string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VsDebugError(msg(), 'connect-failed')), ms)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })

/** 没有 .sln（没生成 VS 工程、纯蓝图项目）时返回空：卡片不显示 */
export async function vsDebugState(p: UeProject): Promise<VsDebugState | undefined> {
  const solution = await findSolution(p)
  if (!solution) return undefined
  // vswhere 第一次要一两秒：等不到就这次先不带 devenv，查到后有缓存
  const devenv = await Promise.race([findDevenv(), new Promise<undefined>((r) => setTimeout(r, 300))])
  const base: VsDebugState = { available: false, solution, ...(devenv ? { devenv } : {}) }
  try {
    const [st, bp] = await budget(
      (async () => {
        const { endpoint } = await endpointOf(p)
        return pipeCall(
          endpoint,
          [
            { op: 'status', args: { frames: 5 } },
            { op: 'bp.list', args: { limit: 50 } },
          ],
          { connectTimeoutMs: STATE_BUDGET_MS, readTimeoutMs: STATE_BUDGET_MS, ...overridePath(endpoint.pipe) },
        )
      })(),
      STATE_BUDGET_MS,
      () => t('VS 在 {s} 秒内没有回应调试状态（可能正忙或弹着对话框）', { s: STATE_BUDGET_MS / 1000 }),
    )
    if (!st.ok) return { ...base, reason: 'error', message: st.error }
    return {
      ...base,
      available: true,
      status: st.result as unknown as VsDebugStatus,
      ...(bp.ok && Array.isArray(bp.result.items) && { breakpoints: bp.result.items as VsBreakpoint[] }),
    }
  } catch (e) {
    const err = e as VsDebugError
    return { ...base, reason: err.reason ?? 'error', message: err.message }
  }
}
