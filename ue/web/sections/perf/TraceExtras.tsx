import { Copy, Crosshair, Filter, LineChart as ChartIcon } from 'lucide-react'
import { useState } from 'react'
import { useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText, SearchBox } from '../../ui.tsx'
import { LineChart } from './charts.tsx'
import { copyText, openMenu } from './menu.tsx'
import { Empty, Skeleton, fmtAt } from './parts.tsx'
import { traceQuery, useDebounced, type Range, type TraceBase } from './trace.ts'

/**
 * trace 右栏的计数器和日志两页（Insights 的 Counters、Log View）。都跟着分析范围走；
 * 行右键：计数器可以画 / 不画、复制名字；日志可以跳到那一刻、复制、只看同一分类。
 */

/** 计数器：列出全部，勾上的在上面画走势（范围内，每段取最大值） */
export function Counters({ id, range, duration }: { id: string; range?: Range; duration: number }) {
  const { project } = useUe()
  const { cn } = h()
  const [filter, setFilter] = useState('')
  const [on, setOn] = useState<string[]>([])
  const list = useLoad(
    () => traceQuery<TraceBase & { counters: { name: string }[] }>(project.id, id, { what: 'counters' }),
    [project.id, id],
  )
  const series = useDebounced(
    on.length
      ? () =>
          traceQuery<TraceBase & { series: { name: string; t: number[]; v: number[] }[] }>(project.id, id, {
            what: 'counters',
            names: on,
            t0: range?.t0 ?? 0,
            t1: range?.t1 ?? duration,
            px: 300,
          })
      : undefined,
    `${on.join('|')}|${range?.t0}|${range?.t1}`,
  )
  const toggle = (n: string) => setOn((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o.slice(-3), n]))
  const names = (list.data?.counters ?? [])
    .map((c) => c.name)
    .filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:border-b ue:border-line ue:p-2">
        <SearchBox placeholder={t('按名字筛，回车搜')} onSearch={setFilter} allowEmpty />
      </div>
      <ErrorText>{list.error || series.error}</ErrorText>
      {on.length > 0 &&
        (series.data?.series ?? []).map((s) => {
          const sorted = [...s.v].sort((a, b) => a - b)
          return (
            <div
              key={s.name}
              className="ue:border-b ue:border-line ue:px-3 ue:py-2 ue:motion-safe:animate-rise"
              onContextMenu={(e) =>
                openMenu(e, [
                  { title: s.name },
                  { label: t('不画这个'), icon: ChartIcon, onClick: () => toggle(s.name) },
                  { label: t('复制名字'), icon: Copy, onClick: () => copyText(s.name) },
                  {
                    label: t('复制数据'),
                    onClick: () => copyText(s.t.map((x, i) => `${x.toFixed(4)}\t${s.v[i]}`).join('\n')),
                  },
                ])
              }
            >
              <div className="ue:mb-1 ue:flex ue:gap-2 ue:text-caption ue:text-subtle">
                <span className="ue:min-w-0 ue:flex-1 ue:truncate">{s.name}</span>
                {sorted.length > 0 && (
                  <span className="ue:shrink-0 ue:font-mono">
                    {fmtNum(sorted[0])} – {fmtNum(sorted.at(-1)!)}
                  </span>
                )}
              </div>
              <LineChart
                lines={[{ name: s.name, values: s.v, stroke: 'ue:stroke-accent' }]}
                height={96}
                fmt={(v) => fmtNum(v)}
                label={s.name}
              />
            </div>
          )
        })}
      {!list.data && !list.error && <Skeleton rows={6} />}
      {list.data && !names.length && <Empty>{t('这份 trace 里没有计数器（录制时开 counters 通道）')}</Empty>}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
        {names.slice(0, 300).map((n) => (
          <label
            key={n}
            onContextMenu={(e) =>
              openMenu(e, [
                { title: n },
                { label: on.includes(n) ? t('不画这个') : t('画走势'), icon: ChartIcon, onClick: () => toggle(n) },
                { label: t('复制名字'), icon: Copy, onClick: () => copyText(n) },
              ])
            }
            className={cn(
              'ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-[3px] ue:text-footnote ue:transition-colors ue:hover:bg-hover',
              on.includes(n) && 'ue:text-fg',
            )}
          >
            <input type="checkbox" className="ue:accent-(--accent)" checked={on.includes(n)} onChange={() => toggle(n)} />
            <span className="ue:truncate">{n}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export const fmtNum = (v: number) =>
  Math.abs(v) >= 1e6
    ? `${(v / 1e6).toFixed(1)}M`
    : Math.abs(v) >= 1e3
      ? `${(v / 1e3).toFixed(1)}k`
      : v.toFixed(v % 1 ? 1 : 0)

const VERB: Record<string, string> = {
  Error: 'ue:text-danger',
  Fatal: 'ue:text-danger',
  Warning: 'ue:text-warning',
}

/** 范围内的日志：点一行时间轴跳过去 */
export function TraceLog({ id, range, onJump }: { id: string; range?: Range; onJump: (t: number) => void }) {
  const { project } = useUe()
  const { cn } = h()
  const [filter, setFilter] = useState('')
  const [boxKey, setBoxKey] = useState(0)
  const res = useDebounced(
    () =>
      traceQuery<TraceBase & { items: { t: number; v: string; c: string; m: string }[]; total: number }>(
        project.id,
        id,
        {
          what: 'log',
          ...range,
          filter: filter || undefined,
          top: 500,
        },
      ),
    `${id}|${range?.t0}|${range?.t1}|${filter}`,
  )
  const items = res.data?.items ?? []
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:border-b ue:border-line ue:p-2">
        <SearchBox
          key={boxKey}
          initial={filter}
          placeholder={t('按内容或分类筛，回车搜')}
          onSearch={setFilter}
          allowEmpty
          busy={res.loading}
        />
      </div>
      <ErrorText>{res.error}</ErrorText>
      {!res.data && !res.error && <Skeleton rows={8} />}
      {res.data && !items.length && <Empty>{t('这段时间里没有日志（录制时开 log 通道）')}</Empty>}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:font-mono ue:text-caption">
        {items.map((x, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onJump(x.t)}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: t('在时间轴上跳到这一刻'), icon: Crosshair, hint: fmtAt(x.t), onClick: () => onJump(x.t) },
                {
                  label: t('只看 {c} 分类', { c: x.c || '—' }),
                  icon: Filter,
                  disabled: !x.c,
                  onClick: () => {
                    setFilter(x.c)
                    setBoxKey((k) => k + 1)
                  },
                },
                'sep',
                { label: t('复制这条日志'), icon: Copy, onClick: () => copyText(x.m) },
                {
                  label: t('复制（带时间和分类）'),
                  onClick: () => copyText(`[${x.t.toFixed(3)}] ${x.c}: ${x.v}: ${x.m}`),
                },
                {
                  label: t('复制全部 {n} 条', { n: items.length }),
                  onClick: () => copyText(items.map((y) => `[${y.t.toFixed(3)}] ${y.c}: ${y.v}: ${y.m}`).join('\n')),
                },
              ])
            }
            className="ue:flex ue:w-full ue:gap-2 ue:px-3 ue:py-[2px] ue:text-left ue:transition-colors ue:hover:bg-hover"
          >
            <span className="ue:shrink-0 ue:text-subtle">{x.t.toFixed(3)}</span>
            <span className={cn('ue:shrink-0', VERB[x.v] ?? 'ue:text-muted')}>{x.c}</span>
            <span className={cn('ue:min-w-0 ue:truncate', VERB[x.v] ?? 'ue:text-fg')} title={x.m}>
              {x.m}
            </span>
          </button>
        ))}
        {res.data && res.data.total > items.length && (
          <div className="ue:px-3 ue:py-2 ue:font-sans ue:text-subtle">
            {t('共 {n} 条，只列前 {m} 条', { n: res.data.total, m: items.length })}
          </div>
        )}
      </div>
    </div>
  )
}
