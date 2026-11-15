import { ChevronDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { MenuHost, openMenuAt } from '../menu.tsx'

export interface CategoryItem {
  key: string
  label: string
  title?: string
  /** 「改过的」用强调色字 */
  tone?: 'accent'
  /** 名字后面的小数字 */
  count?: number
}

/**
 * 属性分类栏（设计稿第 7 节）：只占一行，按宽度能放几个放几个，放不下的收进最右边的「更多 N ▾」下拉；
 * 当前选中的分类在「更多」里时，把它换到行里最后一个位置显示，一眼看得到选的是什么。
 * 宽度用 ResizeObserver 量（容器变宽变窄、分类换了都重算），不轮询。
 * 第一项（「所有」）永远在行里
 */
export function CategoryBar({
  items,
  value,
  onChange,
  max,
  label,
}: {
  items: CategoryItem[]
  value: string
  onChange: (key: string) => void
  /** 行里最多放几个（设置 →「组件」里调着看；不给时只按宽度） */
  max?: number
  label: string
}) {
  const { cn } = h()
  const box = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [fit, setFit] = useState(items.length)
  const sig = items.map((i) => `${i.key}:${i.label}:${i.count ?? ''}`).join('|')

  useLayoutEffect(() => {
    const el = box.current
    const r = ruler.current
    if (!el || !r) return
    const measure = () => {
      const widths = [...r.children].map((c) => (c as HTMLElement).offsetWidth)
      const moreW = (more.current?.offsetWidth || 72) + GAP
      const avail = el.clientWidth
      let used = 0
      let n = 0
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i] + (i ? GAP : 0)
        // 后面还有放不下的，就要给「更多」留位置
        const rest = i < widths.length - 1 ? moreW : 0
        if (used + w + rest > avail) break
        used += w
        n++
      }
      setFit(Math.max(1, n))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(r)
    return () => ro.disconnect()
  }, [sig])

  const limit = Math.max(1, Math.min(fit, max ?? Infinity))
  let shown = items.slice(0, limit)
  let hidden = items.slice(limit)
  const selHidden = hidden.find((i) => i.key === value)
  if (selHidden && limit > 1) {
    // 选中的在「更多」里：换掉行里最后一个
    const out = shown[shown.length - 1]
    shown = [...shown.slice(0, -1), selHidden]
    hidden = [out, ...hidden.filter((i) => i !== selHidden)]
  }

  const chip = (it: CategoryItem, measureOnly = false): ReactNode => {
    const on = !measureOnly && value === it.key
    return (
      <button
        key={it.key}
        type="button"
        tabIndex={measureOnly ? -1 : undefined}
        title={it.title}
        aria-current={on ? 'true' : undefined}
        onClick={measureOnly ? undefined : () => onChange(on && it.key ? '' : it.key)}
        className={cn(
          'ue:inline-flex ue:h-6 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:border ue:px-2.5 ue:text-footnote ue:whitespace-nowrap ue:transition-colors',
          on
            ? 'ue:border-accent ue:bg-accent ue:text-on-accent'
            : cn(
                'ue:border-line ue:bg-field ue:hover:border-line-strong ue:hover:text-fg',
                it.tone ? 'ue:text-accent-text' : 'ue:text-muted',
              ),
        )}
      >
        {it.label}
        {it.count !== undefined && <span className="ue:text-caption ue:opacity-80">{it.count}</span>}
      </button>
    )
  }

  return (
    <div ref={box} className="ue:relative ue:min-w-0">
      {/* 量宽度用的一排（看不见、不占高度）：每个分类按行里同样的样子画一份 */}
      <div
        ref={ruler}
        aria-hidden
        className="ue:pointer-events-none ue:invisible ue:absolute ue:top-0 ue:left-0 ue:flex ue:h-0 ue:gap-1 ue:overflow-hidden"
      >
        {items.map((it) => chip(it, true))}
      </div>
      <nav aria-label={label} className="ue:flex ue:items-center ue:gap-1 ue:overflow-hidden">
        {shown.map((it) => chip(it))}
        <button
          ref={more}
          type="button"
          aria-haspopup="menu"
          onClick={(e) =>
            openMenuAt(
              e.currentTarget,
              hidden.map((it) => ({
                label: it.count !== undefined ? `${it.label} · ${it.count}` : it.label,
                checked: it.key === value,
                onClick: () => onChange(it.key),
              })),
            )
          }
          className={cn(
            'ue:ml-auto ue:inline-flex ue:h-6 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-0.5 ue:border ue:border-line ue:bg-field ue:px-2 ue:text-footnote ue:text-muted ue:hover:border-line-strong ue:hover:text-fg',
            !hidden.length && 'ue:invisible ue:absolute ue:right-0',
          )}
        >
          {t('更多 {n}', { n: hidden.length })}
          <ChevronDown className="ue:h-3.5 ue:w-3.5" />
        </button>
      </nav>
      <MenuHost />
    </div>
  )
}

/** 分类之间的间距（gap-1） */
const GAP = 4

/** 设置 →「组件」里的示例：分类很多的对象，拖窄窗口或调「最多显示」看收进「更多」 */
export function CategoryBarSpecimen() {
  const names = [
    'StaticMesh',
    'Materials',
    'LOD',
    'Nanite',
    'Collision',
    'Navigation',
    'Lighting',
    'Rendering',
    'Physics',
    'Cooking',
    'ImportSettings',
    'Tags',
  ]
  const items: CategoryItem[] = [
    { key: '', label: t('所有') },
    ...names.map((n) => ({ key: n, label: n })),
    { key: '__internal', label: t('内部') },
    { key: '__changed', label: t('改过的'), tone: 'accent' as const, count: 2 },
  ]
  const [v, setV] = useState('')
  const [max, setMax] = useState(0)
  return (
    <div className="ue:flex ue:w-full ue:flex-col ue:gap-3">
      <label className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
        {t('最多显示')}
        <input
          type="range"
          min={0}
          max={items.length}
          value={max}
          onChange={(e) => setMax(Number(e.target.value))}
          className="ue:accent-accent"
        />
        <span className="ue:w-14">{max ? max : t('按宽度')}</span>
      </label>
      <div className="ue:w-full ue:resize-x ue:overflow-hidden ue:border ue:border-line ue:bg-card ue:p-2">
        <CategoryBar items={items} value={v} onChange={setV} max={max || undefined} label={t('属性分类')} />
      </div>
    </div>
  )
}
