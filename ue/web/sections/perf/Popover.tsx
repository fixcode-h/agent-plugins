import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { h } from '../../host.ts'

/**
 * 录制控件的弹出卡（Lua 开关的说明卡、预设列表）：画到 body 上、贴着触发按钮下沿右对齐——
 * 页头有 overflow 裁剪，放在里面会被切掉（和自定义通道面板同样的做法）。点外面、Esc 关
 */
export function Popover({
  anchor,
  onClose,
  children,
  width = 'ue:w-[min(340px,90vw)]',
}: {
  anchor: RefObject<HTMLSpanElement | null>
  onClose: () => void
  children: ReactNode
  /** 卡片宽度（Tailwind 类，默认 340px） */
  width?: string
}) {
  const { cn } = h()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>()
  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) })
    }
    place()
    addEventListener('resize', place)
    return () => removeEventListener('resize', place)
  }, [anchor])
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      if (ref.current?.contains(e.target) || anchor.current?.contains(e.target)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('pointerdown', away)
    addEventListener('keydown', key)
    return () => {
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', key)
    }
  }, [onClose, anchor])
  if (!pos) return null
  return createPortal(
    <div
      ref={ref}
      className={cn(
        'ue:fixed ue:z-[1000] ue:max-h-[calc(100vh-120px)] ue:origin-top-right ue:overflow-auto',
        width,
        ' ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-2 ue:shadow-lg ue:motion-safe:animate-pop',
      )}
      style={{ top: pos.top, right: pos.right }}
    >
      {children}
    </div>,
    document.body,
  )
}
