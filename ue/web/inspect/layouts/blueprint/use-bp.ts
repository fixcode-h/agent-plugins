import { op, useLoad } from '../../../api.ts'
import { loadBlueprintComps } from '../../../bp-comps.ts'
import type { Comp } from '../../../CompTree.tsx'
import { useUe } from '../../../ctx.tsx'
import { useTargetInfo } from '../../../ui.tsx'
import type { BpOutline } from './model.ts'

export interface BpData {
  /** 组件树：undefined 还没读回来，null 不是 Actor 蓝图（函数库、动画蓝图）或读不了 */
  comps: Comp[] | null | undefined
  outline?: BpOutline
  outlineError: string
  /** UE 连上了（编辑器或后台编辑器）：没连上时视口、图表给出原因和「启动 UE」 */
  online: boolean
  /** 编辑器没开、是从磁盘上的文件直接读的（只读，只有改过的值）：页头标出来，note 是限制说明 */
  fromFile?: string
  reload: () => void
}

/**
 * 蓝图布局的数据：组件树（components，旧桥接用 bp.outline 补，bp-comps.ts）和大纲（bp.outline：图、变量、分发器）。
 * 两个都按资源路径缓存（切视图、切回来不重读）；切资源时旧数据不拿来用（按 path 对一下）
 */
export function useBpData(path: string): BpData {
  const { project, state } = useUe()
  const { inst } = useTargetInfo()
  const comps = useLoad(
    () => loadBlueprintComps(project.id, path).then((items) => ({ path, items })),
    [project.id, path],
    0,
    `${project.id}/assetview/comps`,
  )
  const outline = useLoad(
    () => op<BpOutline>(project.id, 'bp.outline', { path }, undefined, 120000).then((o) => ({ path, o })),
    [project.id, path],
    0,
    `${project.id}/bp/outline`,
  )
  // 编辑器没开时服务端直接读文件（offline + note），有数据就当连上了，各块照常显示
  const o = outline.data?.path === path ? outline.data.o : undefined
  const fromFile = o?.offline ? (o.note ?? '') || ' ' : undefined
  const online = !!inst?.online || !!state?.background.running || !!fromFile
  return {
    comps: comps.data?.path === path ? comps.data.items : undefined,
    outline: outline.data?.path === path ? outline.data.o : undefined,
    outlineError: outline.error ?? '',
    online,
    fromFile,
    reload: () => {
      comps.reload()
      outline.reload()
    },
  }
}
