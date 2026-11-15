import { isAssetPath, isRuntimePath } from '../details/model.ts'
import { t } from '../host.ts'
import type { ObjKind } from '../ui.tsx'
import type { BarCrumb, BarRecent } from './InspectorBar.tsx'
import type { NavEntry, NavFrom } from './nav-state.ts'

/** 路径最后一段：…:PersistentLevel.Floor1 → Floor1，/Game/A/SM_X.SM_X → SM_X */
export const lastSeg = (p: string) => p.split(/[.:/]/).pop() || p

/** 导航条上的类型徽标：资源本身、运行时实例、类默认值、类 */
export function kindOfPath(p: string): ObjKind {
  if (isAssetPath(p)) return 'assetRef'
  if (isRuntimePath(p)) return 'instance'
  return /\.Default__/.test(p) ? 'asset' : 'class'
}

const FROM: Record<NavFrom, () => string> = {
  outline: () => t('从大纲'),
  tree: () => t('从 UObject 树'),
  search: () => t('从按类搜'),
  folders: () => t('从文件夹'),
  assetSearch: () => t('从资源搜索'),
  pins: () => t('从固定的对象'),
  jump: () => t('从 Ctrl+K'),
  link: () => t('从别的页面'),
}

/** 「最近看过」里写的来路：经哪个属性 / 从浏览栏哪里 */
export const howOf = (e: NavEntry) => (e.via ? t('经 {p}', { p: e.via }) : e.from ? FROM[e.from]() : undefined)

/** 一条记录在面包屑、最近看过里的名字：Actor 带上当时选的组件 */
export function entryName(e: NavEntry) {
  return { name: lastSeg(e.path), sub: e.comp ? lastSeg(e.comp) : undefined }
}

export function toCrumb(e: NavEntry, key: string, onClick?: () => void): BarCrumb {
  const n = entryName(e)
  return {
    key,
    name: n.name,
    sub: n.sub,
    title: e.comp ? `${e.path}\n${e.comp}` : e.path,
    asset: !isRuntimePath(e.path),
    via: e.via,
    onClick,
  }
}

export function toRecent(e: NavEntry, key: string, current: boolean, stale: boolean, onClick: () => void): BarRecent {
  const n = entryName(e)
  return {
    key,
    name: n.sub ? `${n.name} · ${n.sub}` : n.name,
    asset: !isRuntimePath(e.path),
    how: howOf(e),
    current,
    stale,
    onClick,
  }
}
