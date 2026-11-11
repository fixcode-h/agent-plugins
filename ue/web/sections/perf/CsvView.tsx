import { ArrowDown, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card, ErrorText, LinkBtn, Note, SearchBox } from '../../ui.tsx'
import { FrameBars, type Mark } from './charts.tsx'
import { StatsBar, type StatItem } from './StatsBar.tsx'
import type { Capture, CsvSummary, Series } from './types.ts'

interface Segment {
  from: string
  at: number
  frames: number
  seconds: number
  stats: Record<string, { avg: number; p95: number; max: number }>
}
interface ColRow {
  name: string
  avg: number
  p95: number
  max: number
}
interface Hitch {
  frame: number
  at: number
  ms: number
  events: string[]
  spikes: { column: string; value: number; median: number }[]
}

const CHART_COLS = ['FrameTime', 'GameThreadTime', 'RenderThreadTime', 'GPUTime']
type SortKey = 'name' | 'avg' | 'p95' | 'max'

/**
 * 一份 CSV 帧数据的详情（性能页设计图 3）：顶上是摘要读数条，下面帧时间图（每段画最慢的一帧，书签标在图上）、
 * 按书签分段（点一段，读数、指标表、最慢的帧都只算这一段）、可排序可搜索的指标表；右栏是最慢的帧和交给 Agent。
 */
export function CsvView({
  capture,
  s,
  onAgent,
}: {
  capture: Capture
  s: CsvSummary
  onAgent?: (extra: string) => void
}) {
  const { project } = useUe()
  const { cn } = h()
  const [col, setCol] = useState('FrameTime')
  const [seg, setSeg] = useState(-1)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'avg', desc: true })
  const [open, setOpen] = useState<number>()
  const q = (body: Record<string, unknown>) => ppost<unknown>(project.id, 'perf/query', { id: capture.id, ...body })

  const segs = useLoad(
    () =>
      s.events.length
        ? (q({ what: 'segment' }) as Promise<{ segments: Segment[] }>)
        : Promise.resolve({ segments: [] }),
    [capture.id],
  )
  const list = segs.data?.segments ?? []
  const cur = seg >= 0 ? list[seg] : undefined
  const range = cur ? { from: cur.at, to: cur.at + cur.seconds } : {}
  const series = useLoad(() => q({ what: 'column', name: col, top: 240 }) as Promise<Series>, [capture.id, col])
  const cols = useLoad(
    () => q({ what: 'columns', name: filter, top: 200, ...range }) as Promise<{ total: number; items: ColRow[] }>,
    [capture.id, filter, seg],
  )
  const hitches = useLoad(
    () => q({ what: 'hitches', top: 12, ...range }) as Promise<{ thresholdMs: number; count: number; worst: Hitch[] }>,
    [capture.id, seg],
  )

  const target = 1000 / (Number(s.meta?.TargetFramerate) || 30)
  const th = { target, unacceptable: Math.max(s.hitches.thresholdMs, target) }
  const pts = series.data?.series ?? []
  const idxAt = (at: number) => {
    const i = pts.findIndex((p) => p.at >= at)
    return i < 0 ? pts.length - 1 : i
  }
  const marks: Mark[] = s.events.map((e) => ({ index: idxAt(e.at), name: e.name }))
  const band: [number, number] | undefined = cur ? [idxAt(cur.at), idxAt(cur.at + cur.seconds)] : undefined

  const key = (name: string) => (cur ? cur.stats[name] : s.key[name])
  const avgOf = (name: string) => key(name)?.avg
  const lv = (v?: number) =>
    (v === undefined ? 'none' : v > th.unacceptable ? 'bad' : v > th.target ? 'warn' : 'ok') as StatItem['level']
  const ft = avgOf('FrameTime')
  const items: StatItem[] = [
    { key: 'fps', label: t('平均 FPS'), value: ft ? (1000 / ft).toFixed(1) : s.fps?.avg.toFixed(1), level: lv(ft) },
    {
      key: 'low',
      label: t('最差 1%'),
      value: cur ? undefined : s.fps?.p99Low.toFixed(0),
      unit: 'fps',
      title: t('选了分段时不算这一项'),
    },
    {
      key: 'hitch',
      label: t('卡顿帧'),
      value: String(hitches.data?.count ?? (cur ? '…' : s.hitches.count)),
      unit: `> ${s.hitches.thresholdMs} ms`,
      level: (hitches.data?.count ?? s.hitches.count) ? 'bad' : 'ok',
    },
    ...(
      [
        ['FrameTime', 'Frame'],
        ['GameThreadTime', 'Game'],
        ['RenderThreadTime', 'Render'],
        ['GPUTime', 'GPU'],
      ] as const
    ).map(([c, label]) => ({ key: c, label, value: avgOf(c)?.toFixed(1), unit: 'ms', level: lv(avgOf(c)) })),
    {
      key: 'draws',
      label: 'Draws',
      value: avgOf('RHI/DrawCalls') === undefined ? undefined : Math.round(avgOf('RHI/DrawCalls')!).toLocaleString(),
    },
  ]

  const rows = [...(cols.data?.items ?? [])].sort((a, b) => {
    const d = sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key]
    return sort.desc ? -d : d
  })
  const th_ = (k: SortKey, label: string) => (
    <th
      className={cn(
        'ue:cursor-pointer ue:px-3 ue:py-1.5 ue:text-caption ue:font-medium ue:select-none ue:hover:text-fg',
        k === 'name' ? 'ue:text-left' : 'ue:text-right',
        sort.key === k ? 'ue:text-fg' : 'ue:text-subtle',
      )}
      onClick={() => setSort((x) => ({ key: k, desc: x.key === k ? !x.desc : k !== 'name' }))}
    >
      {label}
      {sort.key === k && (
        <ArrowDown className={cn('ue:ml-0.5 ue:inline ue:h-3 ue:w-3', !sort.desc && 'ue:rotate-180')} />
      )}
    </th>
  )
  const NUM = 'ue:px-3 ue:py-1.5 ue:text-right ue:font-mono ue:text-footnote ue:tabular-nums ue:text-fg'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <StatsBar items={items} />
      <div className="ue:grid ue:min-h-0 ue:flex-1 ue:gap-4 ue:overflow-auto ue:p-5 ue:xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-4">
          {s.note && <Note>{s.note}</Note>}
          <Card
            title={t('帧时间')}
            aside={
              <span className="ue:flex ue:overflow-hidden ue:rounded-md ue:border ue:border-line-strong">
                {CHART_COLS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCol(c)}
                    className={cn(
                      'ue:cursor-pointer ue:px-2 ue:py-0.5 ue:text-caption',
                      col === c ? 'ue:bg-sel ue:font-medium ue:text-fg' : 'ue:text-muted ue:hover:bg-hover',
                    )}
                  >
                    {c.replace('ThreadTime', '').replace('Time', '')}
                  </button>
                ))}
              </span>
            }
          >
            <div className="ue:px-3 ue:pt-2 ue:pb-3">
              <ErrorText>{series.error}</ErrorText>
              <FrameBars
                values={pts.map((p) => p.max)}
                th={th}
                marks={marks}
                band={band}
                height={190}
                label={t('帧时间走势')}
              />
              <div className="ue:mt-1 ue:flex ue:justify-between ue:font-mono ue:text-[10.5px] ue:text-subtle">
                <span>0 s</span>
                <span>{t('每段画最慢的一帧')}</span>
                <span>{s.seconds} s</span>
              </div>
            </div>
          </Card>
          {!!list.length && (
            <div className="ue:flex ue:flex-wrap ue:gap-2">
              {[{ from: t('全部'), at: 0, seconds: s.seconds, frames: s.frames, stats: s.key } as Segment, ...list].map(
                (x, i) => {
                  const on = seg === i - 1
                  const f = x.stats.FrameTime?.avg
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSeg(i - 1)}
                      className={cn(
                        'ue:cursor-pointer ue:rounded-lg ue:border ue:px-3 ue:py-1.5 ue:text-left',
                        on ? 'ue:border-accent ue:bg-accent-soft' : 'ue:border-line ue:bg-card ue:hover:bg-hover',
                      )}
                    >
                      <div className="ue:text-footnote ue:font-medium ue:text-fg">
                        {x.from === '(开头)' ? t('开头') : x.from}
                      </div>
                      <div className="ue:font-mono ue:text-caption ue:text-subtle">
                        {x.seconds} s{f ? ` · ${(1000 / f).toFixed(1)} fps` : ''}
                      </div>
                    </button>
                  )
                },
              )}
            </div>
          )}
          <Card
            title={t('指标')}
            aside={t('{n} 列{seg}', {
              n: cols.data?.total ?? s.columns,
              seg: cur ? ` · ${t('当前分段：{name}', { name: cur.from })}` : '',
            })}
          >
            <div className="ue:border-b ue:border-line ue:px-3 ue:py-2">
              <SearchBox placeholder={t('列名里包含的文字，回车搜索')} onSearch={setFilter} allowEmpty />
            </div>
            <ErrorText>{cols.error}</ErrorText>
            <div className="ue:max-h-[420px] ue:overflow-auto">
              <table className="ue:w-full ue:border-collapse">
                <thead className="ue:sticky ue:top-0 ue:bg-card">
                  <tr className="ue:border-b ue:border-line">
                    {th_('name', t('指标'))}
                    {th_('avg', t('平均'))}
                    {th_('p95', 'P95')}
                    {th_('max', t('最大'))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className="ue:border-b ue:border-line/60 ue:hover:bg-hover">
                      <td
                        className="ue:max-w-0 ue:truncate ue:px-3 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-fg ue:w-full"
                        title={r.name}
                      >
                        {r.name}
                      </td>
                      <td className={NUM}>{r.avg}</td>
                      <td className={NUM}>{r.p95}</td>
                      <td className={NUM}>{r.max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-4">
          <Card
            title={t('最慢的帧')}
            aside={
              hitches.data
                ? t('{n} 帧超过 {ms} ms', { n: hitches.data.count, ms: hitches.data.thresholdMs })
                : undefined
            }
          >
            <ErrorText>{hitches.error}</ErrorText>
            <ul className="ue:divide-y ue:divide-line">
              {(hitches.data?.worst ?? []).map((w) => (
                <li key={w.frame}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === w.frame ? undefined : w.frame)}
                    className={cn(
                      'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-4 ue:py-2 ue:text-left ue:text-footnote ue:hover:bg-hover',
                      open === w.frame && 'ue:bg-hover',
                    )}
                  >
                    <span className="ue:text-fg">{t('第 {f} 帧', { f: w.frame })}</span>
                    <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-subtle">
                      {w.at} s{w.events.length ? ` · ${w.events.join(', ')}` : ''}
                    </span>
                    <span className="ue:font-mono ue:text-danger">{w.ms} ms</span>
                  </button>
                  {open === w.frame && (
                    <div className="ue:bg-panel ue:px-4 ue:py-2 ue:text-caption">
                      <div className="ue:mb-1 ue:text-subtle">{t('这一帧比平时涨得最多的列：')}</div>
                      {w.spikes.length ? (
                        w.spikes.map((x) => (
                          <div key={x.column} className="ue:flex ue:gap-2 ue:font-mono">
                            <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-fg" title={x.column}>
                              {x.column}
                            </span>
                            <span className="ue:text-danger">{x.value}</span>
                            <span className="ue:text-subtle">{t('平时 {v}', { v: x.median })}</span>
                          </div>
                        ))
                      ) : (
                        <div className="ue:text-subtle">{t('没有明显比平时高的列')}</div>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {hitches.data && !hitches.data.worst.length && (
                <li className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">{t('这一段没有卡顿帧')}</li>
              )}
            </ul>
          </Card>
          {!!Object.keys(s.meta ?? {}).length && (
            <Card title={t('元数据')}>
              <dl className="ue:grid ue:grid-cols-[auto_1fr] ue:gap-x-3 ue:gap-y-1 ue:px-4 ue:py-2 ue:text-caption">
                {Object.entries(s.meta ?? {}).map(([k, v]) => (
                  <div key={k} className="ue:contents">
                    <dt className="ue:text-subtle">{k}</dt>
                    <dd className="ue:truncate ue:font-mono ue:text-fg" title={v}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          <Note tone="info">
            {t('CSV 只有每帧的汇总列，看不到函数调用堆栈；先用它找出哪一段、哪个线程慢，再针对那一段排查。')}
          </Note>
          {onAgent && (
            <LinkBtn
              onClick={() =>
                onAgent(
                  cur
                    ? t('重点看「{name}」这一段（{from} – {to} 秒）。', {
                        name: cur.from,
                        from: cur.at,
                        to: Math.round((cur.at + cur.seconds) * 10) / 10,
                      })
                    : '',
                )
              }
            >
              <MessageSquare className="ue:h-3.5 ue:w-3.5" />{' '}
              {cur ? t('让 Agent 分析「{name}」段', { name: cur.from }) : t('让 Agent 分析')}
            </LinkBtn>
          )}
        </div>
      </div>
    </div>
  )
}
