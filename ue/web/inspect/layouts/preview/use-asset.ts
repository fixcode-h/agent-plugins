import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { useKept } from '../../../keep.ts'
import { useTargetInfo } from '../../../ui.tsx'
import type { PreviewViewId } from './parts.tsx'

/** asset.describe 里预览类布局用到的部分：注册表标签（统计条）、内嵌子对象（材质节点、Niagara 发射器） */
export interface AssetDesc {
  path: string
  name: string
  class: string
  classChain?: string[]
  tags?: Record<string, string>
  subobjects?: { path: string; name: string; class: string }[]
  subobjectCount?: number
  dirty?: boolean
}

/**
 * 资源摘要（asset.describe）：按资源路径缓存，切视图、切回来不重读；切资源时旧数据不拿来用（按 path 对一下）。
 * online 是 UE 连没连上（编辑器或后台编辑器）：没连上时各块说明原因
 */
export function useAssetDesc(path: string) {
  const { project, state } = useUe()
  const { inst } = useTargetInfo()
  const d = useLoad(
    () => op<AssetDesc>(project.id, 'asset.describe', { path }, undefined, 120000).then((r) => ({ path, r })),
    [project.id, path],
    0,
    `${project.id}/layout/desc`,
  )
  return {
    desc: d.data?.path === path ? d.data.r : undefined,
    error: d.error,
    loading: d.loading,
    online: !!inst?.online || !!state?.background.running,
    reload: d.reload,
  }
}

/** 一个对象的属性（props）读成「名字 → 值」：材质实例的参数覆盖、动画的通知、Niagara 的发射器表都从这里取 */
export function usePropMap(path: string, enabled = true) {
  const { project } = useUe()
  const d = useLoad(
    () =>
      enabled && path
        ? op<{ props: { name: string; value: unknown }[] }>(
            project.id,
            'props',
            { path, filter: '', maxChars: 20000 },
            undefined,
            120000,
          ).then((r) => ({ path, map: Object.fromEntries(r.props.map((p) => [p.name, p.value])) }))
        : Promise.resolve(undefined),
    [project.id, path, enabled],
  )
  return { map: d.data?.path === path ? d.data.map : undefined, error: d.error, loading: d.loading }
}

/** 预览类布局中间看什么（预览 / 摘要与引用）：所有预览类布局记在一处，切资源留着 */
export function usePreviewView() {
  const { project } = useUe()
  return useKept<PreviewViewId>(`${project.id}/preview/view`, 'preview')
}
