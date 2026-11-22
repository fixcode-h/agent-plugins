import { CircleHelp } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from './host.ts'

/** 浮层宽度（px）：和面板设置窗口的说明一样宽 */
const TIP_W = 288

/**
 * 名字后面的圆底问号：悬停或键盘聚焦时弹出说明（边界情况、原理、需要哪个版本），照面板设置窗口的 HelpTip。
 * 用户 2026-11-22：名字要短，补充说明挪进这个问号，设置页、属性树、判断条件共用这一个。
 * 浮层画到 body 上按问号的位置摆：属性树、列表都在 overflow 容器里，放在里面会被裁掉；下面放不下时翻到上面
 */
export function HelpTip({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>()
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(8, r.left + r.width / 2 - TIP_W / 2), innerWidth - TIP_W - 8)
    setPos(r.bottom + 160 > innerHeight ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const hide = () => setPos(undefined)
  return (
    <span
      ref={ref}
      role="img"
      tabIndex={0}
      aria-label={t('说明')}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => e.stopPropagation()}
      className={
        'ue:inline-grid ue:h-4 ue:w-4 ue:shrink-0 ue:cursor-help ue:place-items-center ue:rounded-full ue:text-subtle ue:transition-colors ue:outline-none ue:hover:bg-hover ue:hover:text-fg ue:focus-visible:text-fg' +
        (className ? ` ${className}` : '')
      }
    >
      <CircleHelp className="ue:h-3.5 ue:w-3.5" />
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ ...pos, width: TIP_W }}
            className="ue:pointer-events-none ue:fixed ue:z-[1000] ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-3 ue:py-2 ue:text-footnote ue:leading-relaxed ue:font-normal ue:whitespace-pre-line ue:text-muted ue:shadow-lg"
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  )
}
