import { useRef, useState, type DragEvent } from 'react'

/**
 * 文件树的拖动移动（GameTest 场景库，设计稿 12.1）：叶子和文件夹都能拖，放到文件夹上就是移进去，
 * 放到某个叶子上是移进它所在的文件夹，放到树的空白处是移到根。悬停在折叠的文件夹上一会儿自动展开，
 * 能往里放的目标淡 accent 底。拖不进自己、自己的子文件夹和原来就在的文件夹（没有变化）。
 * 只管拖放的手势；真正的移动（先列要改的 call 再确认）由 onMove 的调用方做。
 */

/** 拖的是哪一项：path 是树里的路径（叶子不带扩展名），data 是叶子的数据（文件夹没有） */
export interface DragSrc<T> {
  path: string
  dir: boolean
  data?: T
}

/** 悬停多久自动展开折叠的文件夹 */
const EXPAND_MS = 600

export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** 能不能放：不能放回原来的文件夹，文件夹不能放进自己和自己下面 */
export function canDrop(src: { path: string; dir: boolean }, toDir: string) {
  if (parentOf(src.path) === toDir) return false
  return !(src.dir && (toDir === src.path || toDir.startsWith(`${src.path}/`)))
}

export function useTreeDnd<T>(
  onMove: ((src: DragSrc<T>, toDir: string) => void) | undefined,
  expand: (dir: string) => void,
) {
  const src = useRef<DragSrc<T> | undefined>(undefined)
  // 现在悬停的目标文件夹（'' 是根）；undefined 是没在拖或放不下
  const [over, setOver] = useState<string>()
  const timer = useRef<{ dir: string; id: ReturnType<typeof setTimeout> } | undefined>(undefined)
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current.id)
    timer.current = undefined
  }
  const end = () => {
    src.current = undefined
    clearTimer()
    setOver(undefined)
  }
  if (!onMove) return undefined

  /** 拖到 toDir 上：放得下就接住（preventDefault）并点亮；collapsed 的文件夹停一会儿展开 */
  const hover = (e: DragEvent, toDir: string, collapsed: boolean) => {
    const s = src.current
    if (!s) return
    e.stopPropagation()
    if (!canDrop(s, toDir)) {
      setOver(undefined)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(toDir)
    if (collapsed && timer.current?.dir !== toDir) {
      clearTimer()
      timer.current = { dir: toDir, id: setTimeout(() => expand(toDir), EXPAND_MS) }
    } else if (!collapsed) clearTimer()
  }
  const drop = (e: DragEvent, toDir: string) => {
    const s = src.current
    e.preventDefault()
    e.stopPropagation()
    end()
    if (s && canDrop(s, toDir)) onMove(s, toDir)
  }

  /** 一行：叶子的目标是它所在的文件夹，文件夹的目标是它自己 */
  const row = (it: DragSrc<T>, collapsed: boolean) => {
    const toDir = it.dir ? it.path : parentOf(it.path)
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        src.current = it
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', it.path)
      },
      onDragEnd: end,
      onDragOver: (e: DragEvent) => hover(e, toDir, it.dir && collapsed),
      onDrop: (e: DragEvent) => drop(e, toDir),
    }
  }
  /** 树的空白处：移到根 */
  const root = {
    onDragOver: (e: DragEvent) => hover(e, '', false),
    onDrop: (e: DragEvent) => drop(e, ''),
    onDragLeave: (e: DragEvent) => {
      // 离开整棵树才熄灭（在行之间移动也会触发 dragleave）
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        clearTimer()
        setOver(undefined)
      }
    },
  }
  return { row, root, over }
}
