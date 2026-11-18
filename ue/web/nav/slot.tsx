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
  /** 有页面占用插槽时二级面板不再列「本组」的分区；返回释放函数 */
  claim: () => () => void
}

export const SlotCtx = createContext<Slot | null>(null)

/** 二级面板用：建插槽，返回给 Provider 的值和「有没有页面占用」 */
export function useSlot() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [used, setUsed] = useState(0)
  const [value] = useState(() => ({
    el: null as HTMLElement | null,
    claim: () => {
      setUsed((n) => n + 1)
      return () => setUsed((n) => n - 1)
    },
  }))
  return { value: { ...value, el }, setEl, used: used > 0 }
}

/** 分区页面用：插槽在就把 children 放进二级面板，不在就画 fallback */
export function SubNav({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const slot = useContext(SlotCtx)
  const el = slot?.el ?? null
  useEffect(() => (el && slot ? slot.claim() : undefined), [el, slot?.claim])
  if (!el) return <>{fallback}</>
  return createPortal(children, el)
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
