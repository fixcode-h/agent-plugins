import { useMemo, useRef, useState } from 'react'
import * as P from '@radix-ui/react-popover'
import { Plus, X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { EnumOption } from '@shared/table-struct'
import { cn } from '@/lib/utils'
import { popoverPanel } from '@/components/ui/menu'
import type { CellMove } from './CellEditor'

/**
 * repeated 列（一格里存一串值，用分隔符隔开）的编辑：下面列出已有的值，能删，
 * 输入框里打字回车加一项（退格删最后一项）；是枚举或引用时只能从列出的值里选，输入框只用来筛选，
 * 打的字不会直接变成一项（以前会，错字就混进了表格）。确认后按项目的分隔符拼回一格
 */
export function ListEditor({
  init,
  sep,
  options,
  title,
  onDone,
}: {
  init: string
  sep: string
  /** 能选的值（枚举 / 引用）；普通的数字、文字列不传 */
  options?: EnumOption[]
  title: string
  onDone: (v: string | null, move?: CellMove) => void
}) {
  const [items, setItems] = useState(() =>
    init
      .split(sep)
      .map((x) => x.trim())
      .filter(Boolean),
  )
  const [q, setQ] = useState('')
  const ended = useRef(false)
  const end = (v: string | null, move?: CellMove) => {
    if (ended.current) return
    ended.current = true
    onDone(v, move)
  }
  // 有能选的值（枚举 / 引用）时输入框只是筛选，打的字不算一项
  const pickOnly = !!options?.length
  const commit = (move?: CellMove) => end([...items, ...(!pickOnly && q.trim() ? [q.trim()] : [])].join(sep), move)
  const needle = q.trim().toLowerCase()
  const shown = useMemo(
    () =>
      (options ?? [])
        .filter((o) => !needle || o.name.toLowerCase().includes(needle) || o.desc?.toLowerCase().includes(needle))
        .slice(0, 100),
    [options, needle],
  )
  const add = (v: string) => {
    if (v) setItems((xs) => [...xs, v])
    setQ('')
  }
  return (
    <P.Root open>
      <P.Anchor asChild>
        <input
          autoFocus
          aria-label={pickOnly ? t('筛选值') : t('添加一项')}
          value={q}
          placeholder={pickOnly ? t('搜索后点选或回车选第一项') : items.join(sep)}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') return void (e.preventDefault(), end(null))
            if (e.key === 'Backspace' && !q && items.length) return void setItems((xs) => xs.slice(0, -1))
            if (e.key === 'Enter' && q.trim()) {
              e.preventDefault()
              if (pickOnly) return shown.length ? add(shown[0].name) : undefined
              return add(q.trim())
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              commit(e.key === 'Tab' ? (e.shiftKey ? 'left' : 'right') : e.shiftKey ? 'up' : 'down')
            }
          }}
          className="tb:absolute tb:inset-0 tb:z-3 tb:border-0 tb:bg-(--sheet-bg) tb:px-2 tb:font-[inherit] tb:text-[length:inherit] tb:text-fg tb:shadow-[inset_0_0_0_2px_var(--accent)] tb:outline-none tb:placeholder:text-subtle"
        />
      </P.Anchor>
      <P.Portal>
        <P.Content
          side="bottom"
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          className={cn(popoverPanel, 'tb:w-[300px] tb:p-2')}
        >
          <div className="tb:mb-1.5 tb:flex tb:items-center tb:gap-2 tb:text-caption tb:text-subtle">
            <span className="tb:font-mono">{title}</span>
            <span className="tb:ml-auto">{t('分隔符 {sep}', { sep })}</span>
          </div>
          <div className="tb:flex tb:flex-wrap tb:gap-1" role="list" aria-label={t('列表里的值')}>
            {items.map((v, i) => (
              <span
                key={`${i}:${v}`}
                role="listitem"
                className="tb:flex tb:h-6 tb:items-center tb:gap-1 tb:rounded-(--c-chip-radius) tb:bg-sel tb:pr-0.5 tb:pl-2 tb:font-mono tb:text-footnote"
              >
                {v}
                <button
                  type="button"
                  aria-label={t('删掉 {v}', { v })}
                  onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                  className="tb:grid tb:h-5 tb:w-5 tb:cursor-pointer tb:place-items-center tb:rounded-sm tb:text-subtle tb:hover:bg-active tb:hover:text-fg"
                >
                  <X className="tb:h-3 tb:w-3" />
                </button>
              </span>
            ))}
            {!items.length && (
              <span className="tb:text-footnote tb:text-subtle">
                {pickOnly ? t('还没有值，从下面选') : t('还没有值，在上面输入后回车')}
              </span>
            )}
          </div>
          {!!options?.length && (
            <div className="tb:mt-2 tb:max-h-[200px] tb:overflow-y-auto tb:border-t tb:pt-1">
              {shown.map((o) => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => add(o.name)}
                  className="tb:flex tb:w-full tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-menu-itemRadius) tb:px-2 tb:py-1 tb:text-left tb:text-body tb:hover:bg-hover"
                >
                  <Plus className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle" />
                  <span className="tb:min-w-0 tb:truncate tb:font-mono tb:text-footnote">{o.name}</span>
                  {o.desc && (
                    <span className="tb:ml-auto tb:min-w-0 tb:truncate tb:text-caption tb:text-subtle">{o.desc}</span>
                  )}
                </button>
              ))}
              {!shown.length && <p className="tb:px-2 tb:py-1 tb:text-footnote tb:text-subtle">{t('没有匹配的值')}</p>}
            </div>
          )}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
