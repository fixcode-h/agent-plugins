import { useEffect, useMemo, useRef, useState } from 'react'
import * as P from '@radix-ui/react-popover'
import { Check, ChevronDown, Search } from 'lucide-react'
import { t } from '@shared/i18n'
import type { EnumOption } from '@shared/table-struct'
import { cn } from '@/lib/utils'
import { popoverPanel } from '@/components/ui/menu'
import type { CellMove } from './CellEditor'

/** 列表最多画这么多项（枚举表可能几千个值，搜一下就出来） */
const SHOW = 300

/**
 * 枚举 / 引用列的编辑：只能从下拉里选，格子本身不能打字。
 * 以前格子就是输入框，打的字不在列表里还会变成「新增枚举值」，一不小心就把错字记进了表格结构；
 * 现在格子只显示当前值，下拉顶上的搜索框只用来筛选（几千个值时要靠它找），写进格子的一定是列表里的值。
 * 新的枚举值到「枚举」里加。清空格子用表格里的 Delete。
 */
export function EnumPicker({
  init,
  cur = init,
  options,
  title,
  onDone,
}: {
  /** 打开编辑时带进来的值：在格子上直接打字进来时是那一个字，拿来当搜索词 */
  init: string
  /** 格子原来的值（打勾、高亮用）；不传就是 init */
  cur?: string
  options: EnumOption[]
  /** 列表顶上的一行：枚举名或引用的表 */
  title: string
  onDone: (v: string | null, move?: CellMove) => void
}) {
  // 打字进来的那个字当搜索词；双击 / F2 进来时搜索框是空的，列出全部
  const [q, setQ] = useState(init !== cur ? init : '')
  const [hi, setHi] = useState(0)
  const ended = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLInputElement>(null)
  // 搜索框在弹出层里，弹出层定好位之后才挂上，autoFocus 赶不上：等一帧再聚焦
  useEffect(() => {
    const id = requestAnimationFrame(() => box.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  const end = (v: string | null, move?: CellMove) => {
    if (ended.current) return
    ended.current = true
    onDone(v, move)
  }
  const needle = q.trim().toLowerCase()
  const shown = useMemo(
    () =>
      options
        .filter(
          (o) =>
            !needle ||
            o.name.toLowerCase().includes(needle) ||
            o.value?.toLowerCase().includes(needle) ||
            o.desc?.toLowerCase().includes(needle),
        )
        .slice(0, SHOW),
    [options, needle],
  )
  const isCur = (o: EnumOption) => o.name === cur || o.value === cur
  useEffect(() => {
    // 没搜的时候高亮当前值，搜了就从第一个开始
    setHi(needle ? 0 : Math.max(0, shown.findIndex(isCur)))
    // 只在搜索词变的时候重新定位
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [needle])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi])
  const pick = (i: number, move?: CellMove) => {
    if (i < shown.length) end(shown[i].name, move)
  }
  return (
    <P.Root open>
      <P.Anchor asChild>
        {/* 格子里只显示当前值和下拉箭头，不能编辑 */}
        <div
          aria-hidden
          onMouseDown={(e) => e.preventDefault()}
          className="tb:absolute tb:inset-0 tb:z-3 tb:flex tb:items-center tb:gap-1 tb:bg-(--sheet-bg) tb:px-2 tb:text-fg tb:shadow-[inset_0_0_0_2px_var(--accent)] tb:select-none"
        >
          <span className="tb:min-w-0 tb:flex-1 tb:truncate">{cur}</span>
          <ChevronDown className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle" />
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          side="bottom"
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(popoverPanel, 'tb:w-[280px] tb:p-1')}
        >
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="tb:flex tb:items-center tb:gap-2 tb:px-2.5 tb:pt-1 tb:pb-1.5 tb:text-caption tb:text-subtle"
          >
            <span className="tb:min-w-0 tb:truncate tb:font-mono">{title}</span>
            <span className="tb:ml-auto tb:shrink-0 tb:tabular-nums">{options.length}</span>
          </div>
          <label className="tb:mx-1 tb:mb-1 tb:flex tb:h-7 tb:items-center tb:gap-1.5 tb:rounded-(--c-input-radius) tb:border tb:bg-(--c-input-bg) tb:px-2 tb:text-subtle tb:focus-within:border-accent">
            <Search className="tb:h-3.5 tb:w-3.5 tb:shrink-0" />
            <input
              ref={box}
              aria-label={t('筛选值')}
              role="combobox"
              aria-expanded
              aria-controls="enum-picker-list"
              placeholder={t('搜索名字、值或说明')}
              value={q}
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => end(null)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Escape') return void (e.preventDefault(), end(null))
                if (e.key === 'ArrowDown')
                  return void (e.preventDefault(), setHi((h) => Math.min(shown.length - 1, h + 1)))
                if (e.key === 'ArrowUp') return void (e.preventDefault(), setHi((h) => Math.max(0, h - 1)))
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  const move = e.key === 'Tab' ? (e.shiftKey ? 'left' : 'right') : e.shiftKey ? 'up' : 'down'
                  // 没有匹配的值时回车不写任何东西：搜索词不会被当成值填进去
                  if (shown.length) return pick(hi, move)
                  if (e.key === 'Tab') return end(null, move)
                }
              }}
              className="tb:h-full tb:min-w-0 tb:flex-1 tb:border-0 tb:bg-transparent tb:text-footnote tb:text-fg tb:outline-none tb:placeholder:text-subtle"
            />
          </label>
          <div
            ref={list}
            id="enum-picker-list"
            role="listbox"
            // 点列表不让搜索框失焦（失焦就算放弃）
            onMouseDown={(e) => e.preventDefault()}
            className="tb:max-h-[260px] tb:overflow-y-auto"
          >
            {shown.map((o, i) => (
              <div
                key={o.name}
                data-i={i}
                role="option"
                aria-selected={i === hi}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(i)}
                className={cn(
                  'tb:flex tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-menu-itemRadius) tb:px-2.5 tb:py-1.5 tb:text-body',
                  i === hi && 'tb:bg-hover',
                )}
              >
                <Check className={cn('tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-accent', !isCur(o) && 'tb:invisible')} />
                <span className="tb:min-w-0 tb:truncate tb:font-mono tb:text-footnote">{o.name}</span>
                {o.value !== undefined && o.value !== o.name && (
                  <span className="tb:shrink-0 tb:font-mono tb:text-caption tb:text-subtle">{o.value}</span>
                )}
                {o.desc && (
                  <span className="tb:ml-auto tb:min-w-0 tb:truncate tb:text-caption tb:text-subtle">{o.desc}</span>
                )}
              </div>
            ))}
            {!shown.length && <p className="tb:px-2.5 tb:py-2 tb:text-footnote tb:text-subtle">{t('没有匹配的值')}</p>}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
