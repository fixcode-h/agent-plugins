import { Check, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { h, t } from '../../host.ts'

/**
 * 性能页的右键菜单（用户 2026-11-11：各个部位都要有右键菜单，照 Unreal Insights）。
 * 一页只有一个菜单：任何地方调 openMenu(e, items) 打开，MenuHost 挂在页面里一次、画到 body 上
 * （挂在 body 上不被分栏的 overflow 裁掉，也不受父级动画的 transform 影响定位）。
 * 打开时从鼠标处淡入放大；点外面、Esc、滚动、窗口失焦都关；上下键选、回车执行。
 */
export type MenuItem =
  | {
      label: string
      icon?: LucideIcon
      onClick: () => void
      disabled?: boolean
      danger?: boolean
      /** 右侧的快捷键 / 说明 */
      hint?: string
      /** 打勾（开关类的菜单项） */
      checked?: boolean
    }
  | { title: string }
  | 'sep'

interface State {
  x: number
  y: number
  items: MenuItem[]
  seq: number
}

let state: State | undefined
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** 在鼠标位置打开菜单；空菜单不开。会拦掉浏览器自己的右键菜单 */
export function openMenu(e: MouseEvent | globalThis.MouseEvent, items: (MenuItem | false | undefined | null)[]) {
  e.preventDefault()
  e.stopPropagation()
  // 去掉条件不满足的项，以及开头、结尾、连着的分隔线
  const list: MenuItem[] = []
  for (const it of items) {
    if (!it) continue
    if (it === 'sep' && (!list.length || list.at(-1) === 'sep')) continue
    list.push(it)
  }
  while (list.at(-1) === 'sep') list.pop()
  if (!list.length) return
  state = { x: e.clientX, y: e.clientY, items: list, seq: ++seq }
  emit()
}

export function closeMenu() {
  if (!state) return
  state = undefined
  emit()
}

/** 复制到剪贴板并提示（菜单里「复制…」都走这里） */
export function copyText(text: string) {
  const { toast } = h()
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(t('已复制')))
    .catch(() => toast.error(t('复制失败：浏览器不让写剪贴板')))
}

export function MenuHost() {
  const cur = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
  if (!cur) return null
  return createPortal(<Menu key={cur.seq} s={cur} />, document.body)
}

const isAction = (it: MenuItem): it is Extract<MenuItem, { onClick: () => void }> =>
  typeof it === 'object' && 'onClick' in it && !it.disabled

function Menu({ s }: { s: State }) {
  const { cn } = h()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: s.x, top: s.y, ox: 'left', oy: 'top' })
  const [act, setAct] = useState(-1)

  // 贴着屏幕边时往左 / 往上翻，动画的原点跟着换
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const flipX = s.x + r.width > innerWidth - 8
    const flipY = s.y + r.height > innerHeight - 8
    setPos({
      left: flipX ? Math.max(8, s.x - r.width) : s.x,
      top: flipY ? Math.max(8, s.y - r.height) : s.y,
      ox: flipX ? 'right' : 'left',
      oy: flipY ? 'bottom' : 'top',
    })
  }, [s])

  useEffect(() => {
    const away = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      closeMenu()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeMenu()
      const idx = s.items.map((x, i) => (isAction(x) ? i : -1)).filter((i) => i >= 0)
      if (!idx.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const at = idx.indexOf(act)
        const next = e.key === 'ArrowDown' ? (at + 1) % idx.length : (at - 1 + idx.length) % idx.length
        setAct(idx[at < 0 && e.key === 'ArrowUp' ? idx.length - 1 : next])
      } else if (e.key === 'Enter' && act >= 0) {
        e.preventDefault()
        const it = s.items[act]
        if (isAction(it)) {
          closeMenu()
          it.onClick()
        }
      }
    }
    addEventListener('pointerdown', away, true)
    addEventListener('contextmenu', away, true)
    addEventListener('keydown', key)
    addEventListener('blur', closeMenu)
    addEventListener('resize', closeMenu)
    addEventListener('wheel', closeMenu, { passive: true })
    return () => {
      removeEventListener('pointerdown', away, true)
      removeEventListener('contextmenu', away, true)
      removeEventListener('keydown', key)
      removeEventListener('blur', closeMenu)
      removeEventListener('resize', closeMenu)
      removeEventListener('wheel', closeMenu)
    }
  }, [s, act])

  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="ue:fixed ue:z-[1000] ue:min-w-48 ue:max-w-80 ue:rounded-lg ue:border ue:border-line ue:bg-card ue:p-1 ue:text-footnote ue:shadow-lg ue:motion-safe:animate-pop"
      style={{ left: pos.left, top: pos.top, transformOrigin: `${pos.oy} ${pos.ox}` }}
    >
      {s.items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="ue:mx-1 ue:my-1 ue:h-px ue:bg-line" />
        if ('title' in it)
          return (
            <div key={i} className="ue:truncate ue:px-2 ue:pt-1.5 ue:pb-1 ue:text-caption ue:text-subtle">
              {it.title}
            </div>
          )
        const Icon = it.icon
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onPointerEnter={() => setAct(i)}
            onClick={() => {
              closeMenu()
              it.onClick()
            }}
            className={cn(
              'ue:flex ue:w-full ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:py-1 ue:text-left ue:transition-colors ue:duration-100 ue:disabled:opacity-40',
              act === i && !it.disabled && 'ue:bg-hover',
              it.danger ? 'ue:text-danger' : 'ue:text-fg',
            )}
          >
            <span className="ue:flex ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:items-center ue:justify-center ue:text-subtle">
              {it.checked ? (
                <Check className="ue:h-3.5 ue:w-3.5 ue:text-accent" />
              ) : Icon ? (
                <Icon className={cn('ue:h-3.5 ue:w-3.5', it.danger && 'ue:text-danger')} />
              ) : null}
            </span>
            <span className="ue:min-w-0 ue:flex-1 ue:truncate">{it.label}</span>
            {it.hint && <span className="ue:shrink-0 ue:pl-3 ue:text-caption ue:text-subtle">{it.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
