import { ChevronRight } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { usePane } from '../../split.tsx'

const OPEN_KEY = 'ue:gt-nodes-open'

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * GameTest 左栏搜索框下面常驻的「节点」块（用户 2026-11-19：节点不要单独一个页签，直接放搜索框下面）：
 * 标题行点了折叠 / 展开，底边拖动调高度，折没折、多高都记在本机
 */
export function NodeShelf({ children, hint }: { children: ReactNode; hint?: string }) {
  const { cn } = h()
  const [open, setOpen] = useState(readOpen)
  const pane = usePane('gt-nodes-h', '240px', 96)
  const box = useRef<HTMLDivElement>(null)
  const start = useRef<{ y: number; h: number } | null>(null)
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1')
    } catch {}
  }
  const clamp = (n: number) => Math.max(pane.min, Math.min(window.innerHeight * 0.7, n))
  return (
    <div className="ue:flex ue:flex-col">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={hint}
        className="ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-(--c-input-radius) ue:px-1 ue:text-footnote ue:font-semibold ue:text-subtle ue:hover:bg-hover ue:hover:text-fg"
      >
        <ChevronRight className={cn('ue:h-3.5 ue:w-3.5 ue:transition-transform', open && 'ue:rotate-90')} />
        {t('节点')}
      </button>
      {open && (
        <>
          <div ref={box} style={{ height: pane.size }} className="ue:min-h-0 ue:overflow-y-auto ue:pt-1">
            {children}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('拖动调整高度')}
            title={t('拖动调整高度，双击恢复默认')}
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              start.current = { y: e.clientY, h: box.current?.getBoundingClientRect().height ?? 0 }
              pane.setDragging(true)
            }}
            onPointerMove={(e) => {
              const s = start.current
              if (s) pane.set(clamp(s.h + e.clientY - s.y))
            }}
            onPointerUp={(e) => {
              const s = start.current
              if (!s) return
              start.current = null
              pane.setDragging(false)
              const n = clamp(s.h + e.clientY - s.y)
              pane.set(n)
              pane.save(n)
            }}
            onDoubleClick={pane.reset}
            className="ue:group ue:relative ue:-my-[3px] ue:h-[7px] ue:cursor-row-resize"
          >
            <span
              className={cn(
                'ue:absolute ue:inset-x-0 ue:top-[3px] ue:h-px ue:bg-line ue:transition-colors ue:group-hover:bg-accent',
                pane.dragging && 'ue:bg-accent',
              )}
            />
          </div>
        </>
      )}
    </div>
  )
}
