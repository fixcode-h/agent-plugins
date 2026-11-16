import { Search } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'

/** 下拉里的一行：主值（等宽）、描述、几列辅助信息 */
export interface PickRow {
  key: string
  label: string
  extra: string[]
}

/**
 * 边打字边查的下拉（GM 参数选表格里的行、关联弹窗里选表格共用）：打字停 200ms 再调 load，上下键选、回车确认。
 * 和面板的下拉菜单同一套样式（--c-menu-*），设置 →「组件」里跟「菜单」的调节项。
 * 数据从哪来由 load 决定，组件不管；搜不到时回车可以直接用输入的文字（allowFree）
 */
export function SearchPick({
  trigger,
  side,
  load,
  onPick,
  value,
  searchPlaceholder,
  summary,
  head,
  footer,
  allowFree,
  wideKey,
  empty,
}: {
  /** 收起时框里显示的内容 */
  trigger: ReactNode
  /** 框右侧的小字（来自哪张表） */
  side?: ReactNode
  load: (q: string) => Promise<{ rows: PickRow[]; total: number }>
  onPick: (r: PickRow) => void
  /** 当前值：列表里高亮这一行 */
  value?: string
  searchPlaceholder: string
  /** 搜索框下面那行：查到几行、搜的是哪几列 */
  summary?: (r: { q: string; n: number; total: number }) => ReactNode
  /** 搜索框下面那行右边（列名） */
  head?: ReactNode
  footer?: ReactNode
  /** 搜不到时回车用输入的文字当值（表里刚加的行、表格插件读不到时也能填） */
  allowFree?: boolean
  /** 主值占满一行（表格路径这类长的），不留描述的位置 */
  wideKey?: boolean
  empty?: string
}) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ rows: PickRow[]; total: number; q: string }>()
  const [err, setErr] = useState('')
  const [act, setAct] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // 打字停 200ms 再查：每个字都查一次，表大时表格插件要连着读好几遍
  useEffect(() => {
    if (!open) return
    let live = true
    const id = setTimeout(() => {
      load(q).then(
        (r) => {
          if (!live) return
          setRes({ ...r, q })
          setErr('')
          setAct(0)
        },
        (e: Error) => live && setErr(e.message),
      )
    }, 200)
    return () => {
      live = false
      clearTimeout(id)
    }
    // load 每次渲染都是新函数，按 q 和开关重查就够了
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open])

  // 点外面关掉
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', off)
    input.current?.focus()
    return () => document.removeEventListener('pointerdown', off)
  }, [open])

  const rows = res?.rows ?? []
  const pick = (r: PickRow) => {
    onPick(r)
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={box} className="ue:relative ue:min-w-0 ue:flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:bg-field ue:px-2.5 ue:text-left ue:text-footnote',
          open ? 'ue:border-focus' : 'ue:border-line-strong',
        )}
      >
        <span className="ue:min-w-0 ue:flex-1 ue:truncate">{trigger}</span>
        {side && (
          <span className="ue:flex ue:min-w-0 ue:shrink ue:items-center ue:gap-1 ue:truncate ue:text-caption ue:text-subtle">
            {side}
          </span>
        )}
      </button>
      {open && (
        <div className="ue:absolute ue:inset-x-0 ue:top-full ue:z-30 ue:mt-1 ue:rounded-(--c-menu-radius) ue:border-(length:--c-menu-border) ue:border-pop-edge ue:bg-(--c-menu-bg) ue:p-1 ue:text-footnote ue:shadow-pop ue:motion-safe:animate-pop">
          <label className="ue:mb-1 ue:flex ue:h-7 ue:items-center ue:gap-2 ue:rounded-md ue:border ue:border-line-strong ue:bg-field ue:px-2">
            <Search className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-fg ue:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setAct((a) => Math.min(a + 1, rows.length - 1))
                else if (e.key === 'ArrowUp') setAct((a) => Math.max(a - 1, 0))
                else if (e.key === 'Escape') setOpen(false)
                else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (rows[act]) pick(rows[act])
                  else if (allowFree && q.trim()) pick({ key: q.trim(), label: '', extra: [] })
                } else return
                e.preventDefault()
              }}
            />
          </label>
          <div className="ue:flex ue:gap-2 ue:px-2 ue:pt-0.5 ue:pb-1 ue:text-caption ue:text-subtle">
            <span className="ue:min-w-0 ue:truncate">
              {err ? '' : res ? summary?.({ q: res.q, n: rows.length, total: res.total }) : t('正在读…')}
            </span>
            {head && <span className="ue:ml-auto ue:shrink-0 ue:truncate">{head}</span>}
          </div>
          {err && <p className="ue:px-2 ue:py-1 ue:text-danger">{err}</p>}
          <div className="ue:max-h-64 ue:overflow-auto">
            {rows.map((r, i) => (
              <button
                key={r.key}
                type="button"
                onPointerEnter={() => setAct(i)}
                onClick={() => pick(r)}
                className={cn(
                  'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-3 ue:rounded-(--c-menu-itemRadius) ue:px-2 ue:text-left',
                  (i === act || r.key === value) && 'ue:bg-hover',
                )}
              >
                <span
                  className={cn(
                    'ue:truncate ue:font-mono ue:text-fg',
                    wideKey ? 'ue:min-w-0 ue:flex-1' : 'ue:w-16 ue:shrink-0',
                  )}
                  title={r.key}
                >
                  {r.key}
                </span>
                {!wideKey && <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-fg">{r.label}</span>}
                {r.extra.map((x, k) => (
                  <span
                    key={k}
                    className="ue:max-w-28 ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle"
                    title={x}
                  >
                    {x}
                  </span>
                ))}
              </button>
            ))}
            {res && !rows.length && !err && (
              <p className="ue:px-2 ue:py-1.5 ue:text-subtle">
                {q.trim()
                  ? allowFree
                    ? t('没搜到。按回车直接用「{q}」', { q: q.trim() })
                    : t('没搜到「{q}」', { q: q.trim() })
                  : (empty ?? t('没有数据'))}
              </p>
            )}
          </div>
          {footer && (
            <div className="ue:mt-1 ue:flex ue:items-center ue:gap-2 ue:border-t ue:border-line ue:px-2 ue:pt-1.5 ue:pb-0.5 ue:text-caption ue:text-subtle">
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
