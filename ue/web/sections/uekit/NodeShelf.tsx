import { ChevronRight } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { SplitHandle, usePaneHeight } from '@panel/web/src/components/ui/split-pane'

const OPEN_KEY = 'ue:gt-nodes-open'
/** 节点块拖高时给上面的列表至少留这么高，列表不会被挤没 */
const LIST_MIN = 120

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * GameTest 左栏底部的「节点」块（用户 2026-11-19：节点不要单独一个页签，常驻在左栏里）。
 * 放在列表下面而不是搜索框下面（用户 2026-11-27）：节点只在打开脚本编辑时出现，放上面时一出一没整个列表跟着上下跳；
 * 放底部后列表顶端位置不变，只是列表区高矮变化。
 * 标题行点了折叠 / 展开，上边拖动调高度（往上拖变高），折没折、多高都记在本机
 */
export function NodeShelf({ children, hint }: { children: ReactNode; hint?: string }) {
  const { cn } = h()
  const [open, setOpen] = useState(readOpen)
  const pane = usePaneHeight('gt-nodes-h', '260px', 96)
  const box = useRef<HTMLDivElement>(null)
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1')
    } catch {}
  }
  // 拖动上限 = 整栏高度 - 其他块（标题、搜索、页签、底部说明）- 列表最小高度；列表块标了 data-list-body，它的高度随拖动变，不算
  const reserve = () => {
    const el = box.current
    const p = el?.parentElement
    if (!el || !p) return 0
    let used = 0
    for (const c of Array.from(p.children)) {
      if (c !== el && !(c as HTMLElement).dataset.listBody) used += (c as HTMLElement).offsetHeight
    }
    return used + LIST_MIN
  }
  return (
    <>
      {open && <SplitHandle pane={pane} paneRef={box} side="right" reserve={reserve} />}
      <div
        ref={box}
        style={open ? { height: pane.size } : undefined}
        className={cn(
          'ue:flex ue:min-h-0 ue:shrink-0 ue:flex-col ue:px-4 ue:pt-1 ue:pb-2',
          // 折起来或窄屏（拖动条只在大屏出现）时用一道细线和列表分开
          open ? 'ue:border-t ue:border-line ue:lg:border-t-0' : 'ue:border-t ue:border-line',
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={hint}
          className="ue:flex ue:h-7 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-(--c-input-radius) ue:px-1 ue:text-footnote ue:font-semibold ue:text-subtle ue:hover:bg-hover ue:hover:text-fg"
        >
          <ChevronRight className={cn('ue:h-3.5 ue:w-3.5 ue:transition-transform', open && 'ue:rotate-90')} />
          {t('节点')}
        </button>
        {open && <div className="ue:min-h-0 ue:flex-1 ue:overflow-y-auto ue:pt-1">{children}</div>}
      </div>
    </>
  )
}
