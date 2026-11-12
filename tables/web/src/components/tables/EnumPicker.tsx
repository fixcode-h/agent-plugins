import { useEffect, useMemo, useRef, useState } from 'react'
import * as P from '@radix-ui/react-popover'
import { Check, Plus } from 'lucide-react'
import { t } from '@shared/i18n'
import type { EnumOption } from '@shared/table-struct'
import { cn } from '@/lib/utils'
import { popoverPanel } from '@/components/ui/menu'
import type { CellMove } from './CellEditor'

/** 列表最多画这么多项（枚举表可能几千个值，搜一下就出来） */
const SHOW = 300

/**
 * 枚举 / 引用列的编辑：格子里是搜索框，下面弹出能选的值（名字、值、说明），方向键挑、回车选。
 * 打的字不在列表里时最后一项是「新增枚举值」：记进项目的表格结构文件，不写进表格本身。
 * 引用列（onAdd 不传）只能选引用的表里已有的值。
 */
export function EnumPicker({
  init,
  options,
  title,
  onDone,
  onAdd,
}: {
  init: string
  options: EnumOption[]
  /** 列表顶上的一行：枚举名或引用的表 */
  title: string
  onDone: (v: string | null, move?: CellMove) => void
  /** 新增枚举值；不传就不能新增 */
  onAdd?: (name: string) => void
}) {
  const [q, setQ] = useState(init)
  const [typed, setTyped] = useState(false)
  const [hi, setHi] = useState(0)
  const ended = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const end = (v: string | null, move?: CellMove) => {
    if (ended.current) return
    ended.current = true
    onDone(v, move)
  }
  // 刚打开时列出全部（当前值高亮）；打了字才筛
  const needle = typed ? q.trim().toLowerCase() : ''
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
  const exact = options.some((o) => o.name === q.trim() || o.value === q.trim())
  const canAdd = !!onAdd && typed && !!q.trim() && !exact
  const count = shown.length + (canAdd ? 1 : 0)
  useEffect(() => {
    if (typed) return setHi(0)
    const i = shown.findIndex((o) => o.name === init || o.value === init)
    setHi(Math.max(0, i))
    // 只在打开时和开始打字时定位
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi])
  const pick = (i: number, move?: CellMove) => {
    if (i < shown.length) return end(shown[i].name, move)
    if (canAdd) {
      onAdd!(q.trim())
      end(q.trim(), move)
    }
  }
  return (
    <P.Root open>
      <P.Anchor asChild>
        <input
          autoFocus
          aria-label={t('选择值')}
          role="combobox"
          aria-expanded
          aria-controls="enum-picker-list"
          value={q}
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value)
            setTyped(true)
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => end(null)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') return void (e.preventDefault(), end(null))
            if (e.key === 'ArrowDown') return void (e.preventDefault(), setHi((h) => Math.min(count - 1, h + 1)))
            if (e.key === 'ArrowUp') return void (e.preventDefault(), setHi((h) => Math.max(0, h - 1)))
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              const move = e.key === 'Tab' ? (e.shiftKey ? 'left' : 'right') : e.shiftKey ? 'up' : 'down'
              // 清空了就是把格子清空
              if (!q.trim()) return end('', move)
              if (count) return pick(hi, move)
              return end(null)
            }
          }}
          className="tb:absolute tb:inset-0 tb:z-3 tb:border-0 tb:bg-(--sheet-bg) tb:px-2 tb:font-[inherit] tb:text-[length:inherit] tb:text-fg tb:shadow-[inset_0_0_0_2px_var(--accent)] tb:outline-none"
        />
      </P.Anchor>
      <P.Portal>
        <P.Content
          side="bottom"
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // 点列表不让输入框失焦（失焦就算放弃）
          onMouseDown={(e) => e.preventDefault()}
          className={cn(popoverPanel, 'tb:w-[280px] tb:p-1')}
        >
          <div className="tb:flex tb:items-center tb:gap-2 tb:px-2.5 tb:pt-1 tb:pb-1.5 tb:text-caption tb:text-subtle">
            <span className="tb:min-w-0 tb:truncate tb:font-mono">{title}</span>
            <span className="tb:ml-auto tb:shrink-0 tb:tabular-nums">{options.length}</span>
          </div>
          <div ref={list} id="enum-picker-list" role="listbox" className="tb:max-h-[260px] tb:overflow-y-auto">
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
                <Check
                  className={cn(
                    'tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-accent',
                    o.name !== init && o.value !== init && 'tb:invisible',
                  )}
                />
                <span className="tb:min-w-0 tb:truncate tb:font-mono tb:text-footnote">{o.name}</span>
                {o.value !== undefined && o.value !== o.name && (
                  <span className="tb:shrink-0 tb:font-mono tb:text-caption tb:text-subtle">{o.value}</span>
                )}
                {o.desc && (
                  <span className="tb:ml-auto tb:min-w-0 tb:truncate tb:text-caption tb:text-subtle">{o.desc}</span>
                )}
              </div>
            ))}
            {!shown.length && !canAdd && (
              <p className="tb:px-2.5 tb:py-2 tb:text-footnote tb:text-subtle">{t('没有匹配的值')}</p>
            )}
            {canAdd && (
              <div
                data-i={shown.length}
                role="option"
                aria-selected={hi === shown.length}
                onMouseEnter={() => setHi(shown.length)}
                onClick={() => pick(shown.length)}
                className={cn(
                  'tb:flex tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-menu-itemRadius) tb:border-t tb:px-2.5 tb:py-1.5 tb:text-body tb:text-accent-text',
                  hi === shown.length && 'tb:bg-hover',
                )}
              >
                <Plus className="tb:h-3.5 tb:w-3.5 tb:shrink-0" />
                {t('新增枚举值「{v}」', { v: q.trim() })}
              </div>
            )}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
