import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { ForgeEntry } from './Forge.tsx'
import type { TreeLeaf } from './tree.tsx'

/**
 * AssetForge 左栏的多选：Ctrl / Cmd 点选加减、Shift 从上一次点的那份连选到这份、Esc 取消。
 * 记的是 entry.key（刷新后路径不变就还选着）；普通点一下就回到单选（由页面调 clear）。
 * 第一次 Ctrl 点时把当前单选的那份也算进来，和资源管理器的习惯一样。
 */
export function useForgePick(current: ForgeEntry | undefined) {
  const [picked, setPicked] = useState<string[]>([])
  const anchor = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!picked.length) return
    const key = (e: KeyboardEvent) => {
      // 输入框里的 Esc 留给输入框（例如清空搜索）
      if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.closest('input,textarea'))) return
      setPicked([])
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [picked.length])

  const onPick = (_path: string, e: ForgeEntry, ev: MouseEvent, visible: TreeLeaf<ForgeEntry>[]) => {
    const base = picked.length ? picked : current ? [current.key] : []
    if (ev.shiftKey) {
      const from = visible.findIndex((v) => v.data.key === (anchor.current ?? current?.key))
      const to = visible.findIndex((v) => v.data.key === e.key)
      if (from >= 0 && to >= 0) {
        const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((v) => v.data.key)
        // Ctrl+Shift 在已选的基础上加一段，只按 Shift 换成这一段
        setPicked(ev.ctrlKey || ev.metaKey ? [...new Set([...base, ...range])] : range)
        return
      }
    }
    anchor.current = e.key
    setPicked(base.includes(e.key) ? base.filter((k) => k !== e.key) : [...base, e.key])
  }

  const clear = (key?: string) => {
    anchor.current = key
    setPicked([])
  }

  return { picked, setPicked, onPick, clear }
}
