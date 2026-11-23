import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { h, t } from './host.ts'
import { forgetPane, storedPane } from '@panel/web/src/components/ui/split-pane'

/**
 * 弹层右下角拖动放大（用户 2026-11-21：类下拉要能拖大）：宽高记在面板 split-pane 同一张表里（pane:<key>.w / .h），
 * 下次打开还是这个大小；双击角标恢复默认。拖的时候按指针位移算，不改弹层的定位
 */
export function useCornerSize(key: string, def: { w: number; h: number }, min: { w: number; h: number }) {
  const [size, setSize] = useState(() => ({
    w: storedPane(`${key}.w`) || def.w,
    h: storedPane(`${key}.h`) || def.h,
  }))
  const save = (s: { w: number; h: number }) => {
    try {
      localStorage.setItem(`pane:${key}.w`, String(Math.round(s.w)))
      localStorage.setItem(`pane:${key}.h`, String(Math.round(s.h)))
    } catch {}
  }
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, ...size }
    let last = size
    const move = (ev: PointerEvent) => {
      last = {
        w: Math.min(window.innerWidth - 32, Math.max(min.w, start.w + ev.clientX - start.x)),
        h: Math.min(window.innerHeight - 32, Math.max(min.h, start.h + ev.clientY - start.y)),
      }
      setSize(last)
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      save(last)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  const reset = () => {
    forgetPane(`${key}.w`)
    forgetPane(`${key}.h`)
    setSize(def)
  }
  return { size, handle: { onPointerDown, onDoubleClick: reset } }
}

/** 右下角的拖动角标 */
export function CornerHandle(props: { onPointerDown: (e: ReactPointerEvent) => void; onDoubleClick: () => void }) {
  const { cn } = h()
  return (
    <div
      {...props}
      role="separator"
      aria-label={t('拖动改大小，双击恢复默认')}
      title={t('拖动改大小，双击恢复默认')}
      className={cn(
        'ue:absolute ue:right-0 ue:bottom-0 ue:z-10 ue:h-3.5 ue:w-3.5 ue:cursor-nwse-resize',
        'ue:bg-[linear-gradient(135deg,transparent_55%,var(--color-line-strong)_55%,var(--color-line-strong)_65%,transparent_65%,transparent_75%,var(--color-line-strong)_75%,var(--color-line-strong)_85%,transparent_85%)]',
        'ue:hover:bg-[linear-gradient(135deg,transparent_55%,var(--color-accent)_55%,var(--color-accent)_65%,transparent_65%,transparent_75%,var(--color-accent)_75%,var(--color-accent)_85%,transparent_85%)]',
      )}
    />
  )
}
