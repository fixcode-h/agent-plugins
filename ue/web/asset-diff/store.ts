import { useSyncExternalStore } from 'react'

/**
 * 正在看哪个资源的版本差异：资源页工具栏的按钮、左栏资源的右键菜单都能打开，弹窗在 UE 页挂一个（AssetDiffHost），资源页、对象页都能用
 */
let current = '' // 模块状态：打开的资源包路径，空是没打开
const subs = new Set<() => void>()

export function openAssetDiff(path: string) {
  current = path.split('.')[0]
  for (const f of subs) f()
}

export function closeAssetDiff() {
  current = ''
  for (const f of subs) f()
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function useAssetDiffTarget() {
  return useSyncExternalStore(subscribe, () => current)
}
