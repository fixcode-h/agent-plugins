import { useState } from 'react'

/**
 * 切页面时留住的界面状态（用户 2026-11-15：在 Object、资源这些页之间切换，搜索结果和选中的都被清空了）。
 * 分区组件按 `项目/分区` 做 key、一切换就卸载，useState 跟着丢；这里放在模块级的表里，整页刷新才清。
 * 只留搜索条件、结果和选中项这类「切回来还要接着看」的东西，不存盘。
 */
const mem = new Map<string, unknown>()

export function kept<T>(key: string): T | undefined {
  return mem.get(key) as T | undefined
}

export function keep(key: string, v: unknown) {
  if (v === undefined) mem.delete(key)
  else mem.set(key, v)
}

/** 和 useState 一样用，值同时记进上面的表；key 里带上项目 id，换项目不串 */
export function useKept<T>(key: string, init: T | (() => T)) {
  const [v, setV] = useState<T>(() =>
    mem.has(key) ? (mem.get(key) as T) : typeof init === 'function' ? (init as () => T)() : init,
  )
  const set = (next: T | ((p: T) => T)) =>
    setV((p) => {
      const n = typeof next === 'function' ? (next as (p: T) => T)(p) : next
      mem.set(key, n)
      return n
    })
  return [v, set] as const
}
