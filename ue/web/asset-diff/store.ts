import { useSyncExternalStore } from 'react'

/**
 * 正在看哪个资源的版本差异：资源页工具栏的按钮、左栏资源的右键菜单都能打开，弹窗在 UE 页挂一个（AssetDiffHost），资源页、对象页都能用
 */
let current = '' // 模块状态：打开的资源包路径，空是没打开
let initialRev = '' // 打开时先选中哪一版（「同一提交里一起改的资源」点过去时停在同一版）
const subs = new Set<() => void>()

export function openAssetDiff(path: string, rev = '') {
  current = path.split('.')[0]
  initialRev = rev
  for (const f of subs) f()
}

/** 取走打开时要先选中的版本（只用一次） */
export function takeInitialRev() {
  const r = initialRev
  initialRev = ''
  return r
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
