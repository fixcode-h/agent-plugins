import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { h } from '../host.ts'

/**
 * 二级面板里「这一页自己的导航」的插槽（设计稿 designs/UE页左侧导航重设计-设计稿.md 方案 B）：
 * 分区页面用 <SubNav> 把自己的页签 / 筛选放进左边二级面板；面板太旧没有图标轨、或二级面板收起时，
 * 插槽不在，照旧画 fallback（原来页里的分段切换），页面不用管左栏是什么样
 */
interface Slot {
  el: HTMLElement | null
  /** 二级面板标题右边的小位置（整栏列表的个数放这里，和标题同一行） */
  aside: HTMLElement | null
  /** 页面占用插槽（有页面放东西才显示二级面板）；wide：放进来的是整栏列表（对象页的大纲），面板加宽、可拖。返回释放函数 */
  claim: (wide?: boolean) => () => void
}

export const SlotCtx = createContext<Slot | null>(null)

/** 二级面板用：建插槽，返回给 Provider 的值和「有没有页面占用」 */
export function useSlot() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [aside, setAside] = useState<HTMLElement | null>(null)
  const [used, setUsed] = useState(0)
  const [wide, setWide] = useState(0)
  const [value] = useState(() => ({
    el: null as HTMLElement | null,
    aside: null as HTMLElement | null,
    claim: (w?: boolean) => {
      setUsed((n) => n + 1)
      if (w) setWide((n) => n + 1)
      return () => {
        setUsed((n) => n - 1)
        if (w) setWide((n) => n - 1)
      }
    },
  }))
  return { value: { ...value, el, aside }, setEl, setAside, used: used > 0, wide: wide > 0 }
}

/** 分区页面用：插槽在就把 children 放进二级面板，不在就画 fallback；wide 见 Slot.claim */
export function SubNav({ children, fallback, wide }: { children: ReactNode; fallback?: ReactNode; wide?: boolean }) {
  const slot = useContext(SlotCtx)
  const el = slot?.el ?? null
  useEffect(() => (el && slot ? slot.claim(wide) : undefined), [el, slot?.claim, wide])
  if (!el) return <>{fallback}</>
  return createPortal(children, el)
}

/** 放到二级面板标题同一行右边（整栏列表的个数）：插槽不在时什么也不画，由页面自己的标题行画 */
export function SubNavAside({ children }: { children: ReactNode }) {
  const el = useContext(SlotCtx)?.aside ?? null
  return el ? createPortal(children, el) : null
}

/** 二级面板里的一组行（页签换成竖排的行）：标题 + 一行一项，右边是数字 */
export function SubRows<T extends string>({
  label,
  rows,
  value,
  onPick,
}: {
  label?: string
  rows: { id: T; label: string; icon?: unknown; meta?: string; tone?: 'danger' | 'warn'; title?: string }[]
  value: T
  onPick: (id: T) => void
}) {
  const { ui } = h()
  const Label = ui.SidePanelLabel!
  const Row = ui.SidePanelRow!
  return (
    <div className="ue:flex ue:flex-col ue:gap-0.5">
      {label && <Label>{label}</Label>}
      {rows.map((r) => (
        <Row
          key={r.id}
          icon={r.icon}
          label={r.label}
          on={r.id === value}
          onClick={() => onPick(r.id)}
          meta={r.meta}
          tone={r.tone}
          title={r.title}
        />
      ))}
    </div>
  )
}

/**
 * 页面左边那一整栏（列表、树）：宽屏放进左边二级面板（用户 2026-11-18 定：列表和二级面板并到一起），
 * 面板太旧或二级面板收起时照旧画页里的那一栏（fallback 里自己带卡片和拖动条）。
 * body(true) 是放进二级面板时的样子：去掉卡片，占满面板
 */
export function DockCol({ body, fallback }: { body: (docked: boolean) => ReactNode; fallback: ReactNode }) {
  return (
    <SubNav wide fallback={fallback}>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">{body(true)}</div>
    </SubNav>
  )
}

/** 放进二级面板的那一栏没了卡片标题：用一行小字补上（配置文件名、个数） */
export function DockHead({ title, aside }: { title?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:px-1 ue:pb-1.5 ue:text-footnote ue:text-subtle">
      <span className="ue:min-w-0 ue:flex-1 ue:truncate">{title}</span>
      {aside}
    </div>
  )
}
