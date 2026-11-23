import { forgetPane, storedPane, usePane } from '@panel/web/src/components/ui/split-pane'
import type { LayoutDef, RegionDef } from '../types.ts'

/**
 * 区域尺寸和开关：尺寸按「布局 id + 区域 id」记在本机（和 split.tsx 的分栏同一张表，键 layout.<布局>.<区域>），
 * 设置 →「资源查看布局」读出来列表、重置；能关掉的区域（optional）关没关也记在本机。
 */
export const paneKey = (layout: string, region: string) => `layout.${layout}.${region}`

/** 上下的区域（左下、底部）记高度，其余记宽度 */
export const isVertical = (r: RegionDef) => r.place === 'leftBottom' || r.place === 'bottom'

const offKey = (layout: string, region: string) => `ue:layout:off:${layout}.${region}`

export function regionOff(layout: string, region: string) {
  try {
    return localStorage.getItem(offKey(layout, region)) === '1'
  } catch {
    return false
  }
}

export function setRegionOff(layout: string, region: string, off: boolean) {
  try {
    if (off) localStorage.setItem(offKey(layout, region), '1')
    else localStorage.removeItem(offKey(layout, region))
  } catch {}
}

/** 这个区域记住的尺寸（像素）；没拖过是 0 */
export const rememberedSize = (layout: string, region: string) => storedPane(paneKey(layout, region))

/** 清掉一个布局里所有记住的尺寸 */
export function forgetSizes(def: LayoutDef) {
  for (const r of def.regions) forgetPane(paneKey(def.id, r.id))
}

/** 一个区域的拖动尺寸：hooks 要无条件调用，布局里声明的每个区域都调一次 */
export function useRegion(layout: string, r: RegionDef) {
  return usePane(paneKey(layout, r.id), r.size, r.min, isVertical(r) ? 'y' : 'x')
}
