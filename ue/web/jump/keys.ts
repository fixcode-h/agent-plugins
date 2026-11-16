import { useEffect } from 'react'

/** 两次 Shift 间隔多少毫秒内算双击（和 IDE 的「双击 Shift 搜索」手感一致） */
export const DOUBLE_SHIFT_MS = 300

/**
 * 判断双击 Shift 的小状态机：两次单独按下的 Shift 间隔 300 毫秒内算一次；中间按了别的键（Shift+字母打大写）、
 * 按住不放的自动重复都不算。拆出来是为了单测，不依赖 DOM
 */
export function doubleShift() {
  let last = 0
  return (e: { key: string; repeat?: boolean }, now: number) => {
    if (e.key !== 'Shift') {
      last = 0
      return false
    }
    if (e.repeat) return false
    if (last && now - last <= DOUBLE_SHIFT_MS) {
      last = 0
      return true
    }
    last = now
    return false
  }
}

/**
 * UE 页打开跳转的快捷键：Ctrl+K（Mac 上 Cmd+K），以及双击 Shift（用户 2026-11-16 要的）。
 * 焦点在输入框里也生效（和 IDE 一样）；只在 UE 页挂着时监听，离开 UE 页就不认
 */
export function useJumpKeys(open: () => void) {
  useEffect(() => {
    const shift = doubleShift()
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open()
        return
      }
      // 输入法组字时的 Shift 是切中英文，不当成双击
      if (e.isComposing) return
      if (shift(e, performance.now())) open()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // open 是 setState 包的，每次渲染新建也没关系：监听只装一次，调到的总是挂载时那个 setter
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
