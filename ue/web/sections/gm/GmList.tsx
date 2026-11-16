import { ChevronRight, CirclePlus, Star, Table2 } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { Badge, SearchBox } from '../../ui.tsx'
import { groupKey, type GmEntry } from './data.ts'

/** 列表里的一行：一条 GM，收藏和最近执行的行还带着当时的参数 */
export interface GmRow {
  id: string
  entry: GmEntry
  args?: string[]
  /** 行尾的小字（最近执行的时间和结果） */
  note?: string
  bad?: boolean
}

export const SrcBadge = ({ src }: { src: GmEntry['src'] }) => (
  <Badge tone={src === 'lua' ? 'accent' : 'muted'}>{src === 'lua' ? 'Lua' : src === 'cpp' ? 'C++' : t('引擎')}</Badge>
)

const MAX = 400

/**
 * 中间的 GM 列表（效果图 1）：一行一条，名字、一行说明、带类型的参数、来源；按分组分段（可折叠）。
 * 正在编辑宏时行尾有 ＋，点了把这条 GM 加进宏（效果图 2）
 */
export function GmList({
  rows,
  grouped,
  sel,
  onSel,
  favs,
  q,
  onQ,
  title,
  onAdd,
  empty,
}: {
  rows: GmRow[]
  grouped: boolean
  sel?: string
  onSel: (r: GmRow) => void
  favs: Set<string>
  q: string
  onQ: (q: string) => void
  title: string
  onAdd?: (r: GmRow) => void
  empty: string
}) {
  const { cn } = h()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const sections: { id: string; label: string; rows: GmRow[] }[] = []
  if (grouped) {
    const m = new Map<string, { id: string; label: string; rows: GmRow[] }>()
    for (const r of rows) {
      const id = groupKey(r.entry.group) || '-'
      if (!m.has(id)) m.set(id, { id, label: r.entry.group || t('未分组'), rows: [] })
      m.get(id)!.rows.push(r)
    }
    sections.push(...[...m.values()].sort((a, b) => a.label.localeCompare(b.label)))
  } else sections.push({ id: '', label: '', rows })
  let shown = 0

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-1.5 ue:border-b ue:border-line ue:p-3">
        <SearchBox initial={q} placeholder={t('名字、说明或参数')} onSearch={onQ} allowEmpty live />
        <span className="ue:text-caption ue:text-subtle">{title}</span>
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {!rows.length && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{empty}</p>}
        {sections.map((s) => {
          const open = !closed.has(s.id)
          return (
            <div key={s.id}>
              {s.id && (
                <button
                  type="button"
                  onClick={() =>
                    setClosed((c) => new Set(c.has(s.id) ? [...c].filter((x) => x !== s.id) : [...c, s.id]))
                  }
                  className="ue:sticky ue:top-0 ue:z-10 ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:bg-card ue:px-3 ue:text-footnote ue:font-medium ue:text-fg"
                >
                  <ChevronRight className={cn('ue:h-3 ue:w-3 ue:text-subtle', open && 'ue:rotate-90')} />
                  <span className="ue:truncate">{s.label}</span>
                  <span className="ue:ml-auto ue:font-normal ue:text-subtle">{s.rows.length}</span>
                </button>
              )}
              {open &&
                s.rows.map((r) => {
                  if (shown++ >= MAX) return null
                  const e = r.entry
                  const on = sel === r.id
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSel(r)}
                      onKeyDown={(ev) => ev.key === 'Enter' && onSel(r)}
                      className={cn(
                        'ue:flex ue:cursor-pointer ue:flex-col ue:gap-0.5 ue:border-b ue:border-line/60 ue:px-3 ue:py-1.5',
                        on ? 'ue:bg-sel ue:shadow-[inset_2px_0_0_var(--accent)]' : 'ue:hover:bg-hover',
                      )}
                    >
                      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
                        <span className="ue:max-w-[60%] ue:shrink-0 ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">
                          {e.name}
                        </span>
                        {favs.has(e.key) && (
                          <Star className="ue:h-3 ue:w-3 ue:shrink-0 ue:fill-current ue:text-warning" />
                        )}
                        {/* 说明跟在名字后面，一条 GM 只占两行（用户嫌旧页的卡片太大，2026-11-16） */}
                        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">
                          {e.src !== 'lua' && e.library ? `${e.owner} · ` : ''}
                          {e.desc}
                        </span>
                        <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1">
                          {e.params.some((p) => p.table) && (
                            <Badge>
                              <Table2 className="ue:h-2.5 ue:w-2.5" />
                              {e.params.find((p) => p.table)!.table!.split('.')[0]}
                            </Badge>
                          )}
                          {e.server && <Badge tone="warn">{t('服务器')}</Badge>}
                          <SrcBadge src={e.src} />
                          {onAdd && (
                            <button
                              type="button"
                              title={t('加到正在编辑的宏')}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                onAdd(r)
                              }}
                              className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-accent"
                            >
                              <CirclePlus className="ue:h-3.5 ue:w-3.5" />
                            </button>
                          )}
                        </span>
                      </div>
                      {/* 没参数的 GM 只占一行 */}
                      {(r.args || r.note || e.params.length > 0) && (
                        <span className="ue:flex ue:min-w-0 ue:gap-2 ue:text-caption ue:text-subtle">
                          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono">
                            {r.args
                              ? r.args.join(' ') || t('（无参数）')
                              : e.params
                                  .map((p) => `${p.name}: ${p.type}${p.default ? ` = ${p.default}` : ''}`)
                                  .join(', ')}
                          </span>
                          {r.note && <span className={cn('ue:shrink-0', r.bad && 'ue:text-danger')}>{r.note}</span>}
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
          )
        })}
        {shown > MAX && (
          <p className="ue:p-3 ue:text-footnote ue:text-subtle">{t('只显示前 {n} 条，搜一下缩小范围', { n: MAX })}</p>
        )}
      </div>
    </div>
  )
}
