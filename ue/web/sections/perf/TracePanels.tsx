import { ArrowDown, Cpu, Layers } from 'lucide-react'
import { useState } from 'react'
import { useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText, SearchBox } from '../../ui.tsx'
import { LineChart } from './charts.tsx'
import { Empty, PctBar, Section, Segmented, Skeleton, Tree, fmtAt, fmtMs, type TreeNode } from './parts.tsx'
import {
  traceQuery,
  useDebounced,
  type PickedBlock,
  type Range,
  type StackRes,
  type TimerRow,
  type TraceBase,
} from './trace.ts'

/**
 * trace 视图右栏的各块（设计 4.1）：计时器表、调用者 / 被调用者树、点中块的调用堆栈、计数器、日志。
 * 每块自己取数，范围（range）变了跟着重取；都是独立组件，TraceView 只负责摆放和传选中状态。
 */

type SortKey = 'excl' | 'incl' | 'count' | 'max'

/** 计时器表（Insights 的 Timers）：默认按独占时间倒序，搜索回车才搜，只给前 200 行 */
export function TimersTable({
  id,
  range,
  seconds,
  picked,
  onPick,
}: {
  id: string
  range?: Range
  seconds: number
  picked?: number
  onPick: (row: TimerRow) => void
}) {
  const { project } = useUe()
  const { cn } = h()
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('excl')
  const key = `${id}|${range?.t0}|${range?.t1}|${filter}|${sort}`
  const res = useDebounced(
    () =>
      traceQuery<TraceBase & { items: TimerRow[]; total: number; seconds: number }>(project.id, id, {
        what: 'timers',
        ...range,
        filter: filter || undefined,
        sort,
        top: 200,
      }),
    key,
    80,
  )
  const items = res.data?.items ?? []
  const span = (res.data?.seconds ?? seconds) * 1000
  const head = (k: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(k)}
      className={cn(
        'ue:flex ue:items-center ue:justify-end ue:gap-0.5 ue:transition-colors',
        sort === k ? 'ue:font-medium ue:text-fg' : 'ue:hover:text-fg',
      )}
    >
      {label}
      <ArrowDown
        className={cn('ue:h-3 ue:w-3 ue:transition-opacity', sort === k ? 'ue:opacity-100' : 'ue:opacity-0')}
      />
    </button>
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:border-b ue:border-line ue:p-2">
        <SearchBox placeholder={t('按名字筛，回车搜')} onSearch={setFilter} allowEmpty busy={res.loading} />
      </div>
      <div className="ue:grid ue:grid-cols-[minmax(0,1fr)_52px_64px_64px_44px] ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle">
        <span>{t('名字')}</span>
        {head('count', t('次数'))}
        {head('excl', t('独占'))}
        {head('max', t('单次最长'))}
        <span className="ue:text-right">%</span>
      </div>
      <ErrorText>{res.error}</ErrorText>
      {!res.data && !res.error && <Skeleton rows={8} />}
      {res.data && !items.length && (
        <Empty>{filter ? t('没有名字里带「{q}」的计时器', { q: filter }) : t('这段时间里没有计时器')}</Empty>
      )}
      <div
        className={cn('ue:min-h-0 ue:flex-1 ue:overflow-auto ue:transition-opacity', res.loading && 'ue:opacity-60')}
      >
        {items.map((x) => {
          const pct = (x.excl / Math.max(span, 1e-6)) * 100
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => onPick(x)}
              title={`${x.name}\n${t('包含')} ${fmtMs(x.incl)} · ${t('平均')} ${fmtMs(x.incl / Math.max(1, x.count))}`}
              className={cn(
                'ue:grid ue:w-full ue:grid-cols-[minmax(0,1fr)_52px_64px_64px_44px] ue:items-center ue:gap-2 ue:px-3 ue:py-[3px] ue:text-left ue:text-footnote ue:transition-colors',
                picked === x.id ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
                {x.gpu ? (
                  <Layers className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-run" />
                ) : (
                  <Cpu className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                )}
                <span className="ue:truncate ue:text-fg">{x.name}</span>
              </span>
              <span className="ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
                {x.count.toLocaleString()}
              </span>
              <span className="ue:text-right ue:font-mono ue:text-caption ue:text-fg ue:tabular-nums">
                {fmtMs(x.excl)}
              </span>
              <span className="ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
                {fmtMs(x.inclMax)}
              </span>
              <span className="ue:flex ue:flex-col ue:items-end ue:gap-0.5">
                <span className="ue:font-mono ue:text-[10.5px] ue:text-subtle ue:tabular-nums">{pct.toFixed(1)}</span>
                <PctBar pct={pct} className="ue:w-full" />
              </span>
            </button>
          )
        })}
        {res.data && res.data.total > items.length && (
          <div className="ue:px-3 ue:py-2 ue:text-caption ue:text-subtle">
            {t('共 {n} 个，只列前 {m} 个：用搜索找其余的', { n: res.data.total, m: items.length })}
          </div>
        )}
      </div>
    </div>
  )
}

/** 调用者 / 被调用者（Insights 的 Butterfly）：选中一个计时器后显示；在树里双击换成以那一项为中心 */
export function CallTree({
  id,
  range,
  timer,
  name,
  onTimer,
}: {
  id: string
  range?: Range
  timer: number
  name: string
  onTimer: (id: number, name: string) => void
}) {
  const { project } = useUe()
  const [side, setSide] = useState<'callees' | 'callers'>('callees')
  const res = useDebounced(
    () =>
      traceQuery<TraceBase & { callers: TreeNode; callees: TreeNode }>(project.id, id, {
        what: 'butterfly',
        timer,
        ...range,
      }),
    `${id}|${timer}|${range?.t0}|${range?.t1}`,
    60,
  )
  const root = res.data?.[side]
  return (
    <Section
      className="ue:flex-1"
      title={<span title={name}>{name}</span>}
      aside={
        <Segmented
          value={side}
          onChange={setSide}
          items={[
            { key: 'callees', label: t('被调用者') },
            { key: 'callers', label: t('调用者') },
          ]}
        />
      }
    >
      <ErrorText>{res.error}</ErrorText>
      {!root && !res.error && <Skeleton rows={6} />}
      {root && (
        <div key={`${side}-${timer}`} className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-rise">
          <TreeHead />
          <Tree root={root} picked={timer} onPick={(n) => n.id !== timer && onTimer(n.id, n.name)} />
        </div>
      )}
    </Section>
  )
}

function TreeHead() {
  return (
    <div className="ue:grid ue:grid-cols-[minmax(0,1fr)_48px_72px_56px] ue:gap-2 ue:border-b ue:border-line ue:py-1 ue:pr-3 ue:pl-2 ue:text-caption ue:text-subtle">
      <span>{t('名字')}</span>
      <span className="ue:text-right">{t('次数')}</span>
      <span className="ue:text-right">{t('包含')}</span>
      <span />
    </div>
  )
}

/** 点中块的调用堆栈：从线程根到它这一层（每层带时间和占上一层的比例），下面是它的直接子调用 */
export function StackView({
  id,
  block,
  laneName,
  onDepth,
  onTimer,
}: {
  id: string
  block: PickedBlock
  laneName: string
  onDepth: (depth: number) => void
  onTimer: (id: number, name: string) => void
}) {
  const { project } = useUe()
  const { cn } = h()
  const res = useLoad(
    () =>
      traceQuery<StackRes>(project.id, id, {
        what: 'stack',
        lane: block.lane,
        time: block.time + 1e-7,
        depth: block.depth,
      }),
    [project.id, id, block.lane, block.time, block.depth],
  )
  const stack = res.data?.stack ?? []
  const sel = stack[res.data?.selected ?? stack.length - 1]
  return (
    <Section
      className="ue:flex-1"
      title={
        <span className="ue:flex ue:items-center ue:gap-1.5">
          {t('调用堆栈')}
          <span className="ue:font-normal ue:text-subtle">
            · {laneName} · {fmtAt(block.time)}
          </span>
        </span>
      }
    >
      <ErrorText>{res.error}</ErrorText>
      {!res.data && !res.error && <Skeleton rows={6} />}
      {res.data && (
        <div
          key={`${block.lane}-${block.time}`}
          className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1 ue:text-footnote ue:motion-safe:animate-rise"
        >
          {stack.map((x, i) => {
            const parent = stack[i - 1]
            const pct = parent ? (x.ms / Math.max(parent.ms, 1e-6)) * 100 : 100
            const on = x.depth === sel?.depth
            return (
              <button
                key={x.depth}
                type="button"
                onClick={() => onDepth(x.depth)}
                onDoubleClick={() => onTimer(x.id, x.name)}
                title={t('{name}（双击看调用者 / 被调用者）', { name: x.name })}
                className={cn(
                  'ue:grid ue:w-full ue:grid-cols-[minmax(0,1fr)_64px_56px] ue:items-center ue:gap-2 ue:py-[3px] ue:pr-3 ue:text-left ue:transition-colors',
                  on ? 'ue:bg-sel' : 'ue:hover:bg-hover',
                )}
                style={{ paddingLeft: 10 + Math.min(x.depth, 20) * 10 }}
              >
                <span className={cn('ue:truncate', on ? 'ue:font-medium ue:text-fg' : 'ue:text-muted')}>{x.name}</span>
                <span className="ue:text-right ue:font-mono ue:text-caption ue:text-fg ue:tabular-nums">
                  {fmtMs(x.ms)}
                </span>
                <PctBar pct={pct} />
              </button>
            )
          })}
          {sel && (
            <div className="ue:mt-2 ue:border-t ue:border-line ue:pt-1">
              <div className="ue:flex ue:items-center ue:gap-2 ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
                <span className="ue:truncate">{t('{name} 里面调用的', { name: sel.name })}</span>
                <span className="ue:ml-auto ue:font-mono">
                  {t('独占')} {fmtMs(sel.excl)}
                </span>
              </div>
              {res.data.children.length === 0 && (
                <div className="ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
                  {t('没有子调用：时间都花在它自己身上')}
                </div>
              )}
              {res.data.children.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => onTimer(k.id, k.name)}
                  className="ue:grid ue:w-full ue:grid-cols-[minmax(0,1fr)_40px_64px_56px] ue:items-center ue:gap-2 ue:px-3 ue:py-[3px] ue:text-left ue:transition-colors ue:hover:bg-hover"
                >
                  <span className="ue:truncate ue:text-muted">{k.name}</span>
                  <span className="ue:text-right ue:font-mono ue:text-caption ue:text-subtle">×{k.count}</span>
                  <span className="ue:text-right ue:font-mono ue:text-caption ue:text-fg">{fmtMs(k.incl)}</span>
                  <PctBar pct={(k.incl / Math.max(sel.ms, 1e-6)) * 100} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

/** 计数器：列出全部，勾上的在下面画走势（范围内，每段取最大值） */
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
        (series.data?.series ?? []).map((s) => (
          <div key={s.name} className="ue:border-b ue:border-line ue:px-3 ue:py-2 ue:motion-safe:animate-rise">
            <div className="ue:mb-1 ue:truncate ue:text-caption ue:text-subtle">{s.name}</div>
            <LineChart
              lines={[{ name: s.name, values: s.v, stroke: 'ue:stroke-accent' }]}
              height={96}
              fmt={(v) => fmtNum(v)}
              label={s.name}
            />
          </div>
        ))}
      {!list.data && !list.error && <Skeleton rows={6} />}
      {list.data && !names.length && <Empty>{t('这份 trace 里没有计数器（录制时开 counters 通道）')}</Empty>}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
        {names.slice(0, 300).map((n) => (
          <label
            key={n}
            className={cn(
              'ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-[3px] ue:text-footnote ue:transition-colors ue:hover:bg-hover',
              on.includes(n) && 'ue:text-fg',
            )}
          >
            <input
              type="checkbox"
              className="ue:accent-(--accent)"
              checked={on.includes(n)}
              onChange={() => setOn((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o.slice(-3), n]))}
            />
            <span className="ue:truncate">{n}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

const fmtNum = (v: number) =>
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
        <SearchBox placeholder={t('按内容或分类筛，回车搜')} onSearch={setFilter} allowEmpty busy={res.loading} />
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
