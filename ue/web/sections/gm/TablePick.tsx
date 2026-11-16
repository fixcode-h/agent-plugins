import { Search, Table2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { h, t } from '../../host.ts'
import type { TableRow } from './tables.ts'

/**
 * 关联了表格列的参数：可搜索的下拉（设计稿 4.2，效果图 1）。打 Id 或名字搜，列 Id、名字和一两列关键信息。
 * 数据由 load 给（GM 页里是 tables.ts 经面板动作读表格插件），组件本身不管从哪来，设置 →「组件」里用假数据展示。
 * 搜不到时回车用输入的文字当值：表里刚加的行、表格插件读不到时也能填
 */
export function TablePick({
  value,
  label,
  binding,
  load,
  onChange,
  footer,
  placeholder,
}: {
  value: string
  /** 当前值对应的名字（「1001 · 新手长剑」里的后半） */
  label?: string
  binding: LuaGmBinding
  load: (q: string) => Promise<{ rows: TableRow[]; total: number }>
  onChange: (v: string, label: string) => void
  /** 下拉底部的说明（关联从哪来、改关联的入口） */
  footer?: ReactNode
  placeholder?: string
}) {
  const { cn } = h()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ rows: TableRow[]; total: number; q: string }>()
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
  const pick = (r: TableRow) => {
    onChange(r.key, r.label)
    setOpen(false)
    setQ('')
  }
  const fileName = binding.table.split('/').pop()

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
        <span className="ue:min-w-0 ue:flex-1 ue:truncate">
          {value ? (
            <>
              <span className="ue:font-mono ue:text-fg">{value}</span>
              {label && <span className="ue:text-muted"> · {label}</span>}
            </>
          ) : (
            <span className="ue:text-subtle">{placeholder ?? t('搜 {key} 或名字', { key: binding.key })}</span>
          )}
        </span>
        <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:text-caption ue:text-subtle">
          <Table2 className="ue:h-3 ue:w-3" />
          {fileName} · {binding.key}
        </span>
      </button>
      {open && (
        <div className="ue:absolute ue:inset-x-0 ue:top-full ue:z-30 ue:mt-1 ue:rounded-(--c-menu-radius) ue:border-(length:--c-menu-border) ue:border-pop-edge ue:bg-(--c-menu-bg) ue:p-1 ue:text-footnote ue:shadow-pop ue:motion-safe:animate-pop">
          <label className="ue:mb-1 ue:flex ue:h-7 ue:items-center ue:gap-2 ue:rounded-md ue:border ue:border-line-strong ue:bg-field ue:px-2">
            <Search className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('{key} 或名字', { key: binding.key })}
              className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-fg ue:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setAct((a) => Math.min(a + 1, rows.length - 1))
                else if (e.key === 'ArrowUp') setAct((a) => Math.max(a - 1, 0))
                else if (e.key === 'Escape') setOpen(false)
                else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (rows[act]) pick(rows[act])
                  else if (q.trim()) pick({ key: q.trim(), label: '', extra: [] })
                } else return
                e.preventDefault()
              }}
            />
          </label>
          <div className="ue:flex ue:px-2 ue:pt-0.5 ue:pb-1 ue:text-caption ue:text-subtle">
            <span className="ue:truncate">
              {err
                ? ''
                : res
                  ? res.q
                    ? t('{file} · {key} 或名字含「{q}」· {n} 行', { file: fileName ?? '', key: binding.key, q: res.q, n: res.total })
                    : t('{file} · 前 {n} 行', { file: fileName ?? '', n: rows.length })
                  : t('正在读表…')}
            </span>
            {binding.extra?.length ? <span className="ue:ml-auto ue:pl-2">{binding.extra.join(' · ')}</span> : null}
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
                <span className="ue:w-16 ue:shrink-0 ue:truncate ue:font-mono ue:text-fg">{r.key}</span>
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-fg">{r.label}</span>
                {r.extra.map((x, k) => (
                  <span key={k} className="ue:shrink-0 ue:text-caption ue:text-subtle">
                    {x}
                  </span>
                ))}
              </button>
            ))}
            {res && !rows.length && !err && (
              <p className="ue:px-2 ue:py-1.5 ue:text-subtle">
                {q.trim() ? t('没搜到。按回车直接用「{q}」', { q: q.trim() }) : t('这张表没有数据')}
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

/** 设置 →「组件」里的示例：假数据，不连表格插件 */
const DEMO: TableRow[] = [
  { key: '1001', label: '新手长剑', extra: ['普通'] },
  { key: '1002', label: '精钢长剑', extra: ['优秀'] },
  { key: '1010', label: '寒霜之剑', extra: ['稀有'] },
  { key: '1022', label: '赤焰巨剑', extra: ['史诗'] },
  { key: '2001', label: '皮甲', extra: ['普通'] },
]
export function TablePickSpecimen() {
  const [v, setV] = useState({ key: '1001', label: '新手长剑' })
  return (
    <div className="ue:w-full ue:max-w-md ue:pb-72">
      <TablePick
        value={v.key}
        label={v.label}
        binding={{ table: 'Config/Item.xlsx', key: 'Id', label: 'Name', extra: ['Quality'] }}
        load={async (q) => {
          const rows = DEMO.filter((r) => !q || r.key.includes(q) || r.label.includes(q))
          return { rows, total: rows.length }
        }}
        onChange={(key, label) => setV({ key, label })}
        footer={<span>{t('关联 itemId → Item.xlsx 的 Id')}</span>}
      />
    </div>
  )
}
