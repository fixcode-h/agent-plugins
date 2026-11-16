import type { VsDebugStatus } from '../types.ts'
import { t } from '../util.ts'

/**
 * VS 正在编译、等着启动或在调试 UE：都算前台要起来了。
 * 编译也算：F5 先编译再启动，而且后台编辑器占着项目模块的 DLL，VS 链接会写不进去。
 * VS 附加的正好是后台编辑器（bgPid）时不算，那是在调后台编辑器本身
 */
export function vsForegroundWhy(st: VsDebugStatus | undefined, bgPid?: number): string | undefined {
  if (!st) return undefined
  if (st.building || st.launchPending) return t('VS 正在编译或启动 UE：同时只开一个编辑器，不另起后台编辑器')
  const procs = (st.processes ?? []).filter((x) => x.pid !== bgPid)
  if (st.mode !== 'design' && procs.length)
    return t('VS 正在调试 UE（PID {pid}）：同时只开一个编辑器，不另起后台编辑器', { pid: procs[0]!.pid })
  return undefined
}
