import { Copy, Crosshair, GitFork, Layers, Scan, Search, ZoomIn } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText } from '../../ui.tsx'
import { copyText, openMenu, type MenuItem } from './menu.tsx'
import { Empty, PctBar, Section, Skeleton, TREE_COLS, Tree, fmtAt, fmtMs, type TreeNode } from './parts.tsx'
import {
  traceQuery,
  useDebounced,
  type Instances,
  type PickedBlock,
  type Range,
  type StackRes,
  type TraceBase,
} from './trace.ts'

/**
 * trace 视图右栏下半的几块（照 Insights）：调用者 / 被调用者上下两棵树、点中块的调用堆栈、一个计时器的每次调用（最慢的几次）。
 * 每块自己取数，范围（range）变了跟着重取；动作（选计时器、跳到时间轴某处、设区间）由 TraceView 给。
 * 计时器表在 TimersTable.tsx，计数器和日志在 TraceExtras.tsx。
 */
export interface PanelActions {
  /** 选中计时器：看调用者 / 被调用者、时间轴高亮 */
  pickTimer: (id: number, name: string) => void
  /** 找这个计时器最慢的几次 */
  slowest: (id: number, name: string) => void
  /** 时间轴缩放到这一段 */
  zoom: (t0: number, t1: number) => void
  /** 设成分析范围 */
  setRange: (r: Range) => void
  /** 选中时间轴上的一块（看它的调用堆栈） */
  pickBlock: (b: PickedBlock) => void
}

/** 计时器的通用右键项：调用树、最慢一次、复制名字 */
const timerItems = (a: PanelActions, id: number, name: string): MenuItem[] => [
  { title: name },
  { label: t('以它为中心看调用者 / 被调用者'), icon: GitFork, onClick: () => a.pickTimer(id, name) },
  { label: t('找最慢的一次'), icon: Search, onClick: () => a.slowest(id, name) },
  'sep',
  { label: t('复制名字'), icon: Copy, onClick: () => copyText(name) },
]

const treeText = (n: TreeNode, depth = 0): string =>
  [
    `${'  '.repeat(depth)}${n.name}  ×${n.count}  ${fmtMs(n.incl)}${n.excl !== undefined ? ` (excl ${fmtMs(n.excl)})` : ''}`,
    ...(n.children ?? []).map((k) => treeText(k, depth + 1)),
  ].join('\n')

/**
 * 调用者 / 被调用者（Insights 的 Callers、Callees）：选中一个计时器后上下两棵树同时显示，
 * 列是次数、包含、占父、占根、独占。在树里点一项换成以它为中心。
 */
export function CallTree({
  id,
  range,
  timer,
  name,
  actions,
}: {
  id: string
  range?: Range
  timer: number
  name: string
  actions: PanelActions
}) {
  const { project } = useUe()
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
  const half = (side: 'callers' | 'callees') => {
    const root = res.data?.[side]
    return (
      <Section
        className="ue:min-h-0 ue:flex-1"
        title={
          <span className="ue:flex ue:items-center ue:gap-1.5">
            {side === 'callers' ? t('调用者') : t('被调用者')}
            <span className="ue:truncate ue:font-normal ue:text-subtle" title={name}>
              · {name}
            </span>
          </span>
        }
        aside={
          range ? (
            <span className="ue:font-mono ue:text-caption ue:text-subtle">{fmtMs((range.t1 - range.t0) * 1000)}</span>
          ) : (
            <span className="ue:text-caption ue:text-subtle">{t('整段')}</span>
          )
        }
      >
        <ErrorText>{res.error}</ErrorText>
        {!root && !res.error && <Skeleton rows={4} />}
        {root && (
          <div
            key={`${side}-${timer}`}
            className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-rise"
          >
            <TreeHead />
            <Tree
              root={root}
              picked={timer}
              onPick={(n) => n.id !== timer && actions.pickTimer(n.id, n.name)}
              onMenu={(e, n, extra) =>
                openMenu(e, [
                  ...timerItems(actions, n.id, n.name),
                  { label: t('复制这棵树'), onClick: () => copyText(treeText(root)) },
                  'sep',
                  ...extra,
                ])
              }
            />
          </div>
        )}
      </Section>
    )
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {half('callers')}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:border-t ue:border-line">{half('callees')}</div>
    </div>
  )
}

function TreeHead() {
  const { cn } = h()
  return (
    <div
      className={cn(
        'ue:grid ue:gap-2 ue:border-b ue:border-line ue:py-1 ue:pr-3 ue:pl-2 ue:text-caption ue:text-subtle',
        TREE_COLS,
      )}
    >
      <span>{t('名字')}</span>
      <span className="ue:text-right">{t('次数')}</span>
      <span className="ue:text-right">{t('包含')}</span>
      <span className="ue:text-right">{t('占父')}</span>
      <span className="ue:text-right">{t('占根')}</span>
      <span className="ue:text-right">{t('独占')}</span>
    </div>
  )
}

/** 点中块的调用堆栈：从线程根到它这一层（每层带时间和占上一层的比例），下面是它的直接子调用 */
export function StackView({
  id,
  block,
  laneName,
  onDepth,
  actions,
}: {
  id: string
  block: PickedBlock
  laneName: string
  onDepth: (depth: number) => void
  actions: PanelActions
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
  const stackText = () => stack.map((x) => `${'  '.repeat(x.depth)}${x.name}  ${fmtMs(x.ms)}`).join('\n')
  const rowMenu = (e: MouseEvent, x: StackRes['stack'][number]) =>
    openMenu(e, [
      { title: x.name },
      { label: t('选中这一层'), icon: Layers, onClick: () => onDepth(x.depth) },
      {
        label: t('时间轴缩放到这一层'),
        icon: ZoomIn,
        onClick: () => actions.zoom(x.start, x.start + x.ms / 1000),
      },
      {
        label: t('设为分析范围'),
        icon: Scan,
        onClick: () => actions.setRange({ t0: x.start, t1: x.start + x.ms / 1000 }),
      },
      'sep',
      ...timerItems(actions, x.id, x.name).slice(1),
      { label: t('复制整条调用堆栈'), onClick: () => copyText(stackText()) },
    ])
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
                onDoubleClick={() => actions.pickTimer(x.id, x.name)}
                onContextMenu={(e) => rowMenu(e, x)}
                title={[
                  x.name,
                  `${t('包含')} ${fmtMs(x.ms)} · ${t('独占')} ${fmtMs(x.excl)}`,
                  parent ? `${t('占父')} ${pct.toFixed(2)}%（${parent.name}）` : '',
                  stack[0] ? `${t('占根')} ${((x.ms / Math.max(stack[0].ms, 1e-6)) * 100).toFixed(2)}%（${stack[0].name}）` : '',
                  `${t('深度')} ${x.depth} · ${t('开始')} ${fmtAt(x.start)}`,
                  t('双击看调用者 / 被调用者，右键更多'),
                ]
                  .filter(Boolean)
                  .join('\n')}
                className={cn(
                  'ue:grid ue:w-full ue:grid-cols-[minmax(0,1fr)_64px_56px_56px] ue:items-center ue:gap-2 ue:py-[3px] ue:pr-3 ue:text-left ue:transition-colors',
                  on ? 'ue:bg-sel' : 'ue:hover:bg-hover',
                )}
                style={{ paddingLeft: 10 + Math.min(x.depth, 20) * 10 }}
              >
                <span className={cn('ue:truncate', on ? 'ue:font-medium ue:text-fg' : 'ue:text-muted')}>{x.name}</span>
                <span className="ue:text-right ue:font-mono ue:text-caption ue:text-fg ue:tabular-nums">
                  {fmtMs(x.ms)}
                </span>
                <span className="ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
                  {fmtMs(x.excl)}
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
                  onClick={() => actions.pickTimer(k.id, k.name)}
                  onContextMenu={(e) => openMenu(e, timerItems(actions, k.id, k.name))}
                  title={`${k.name}\n${t('平均')} ${fmtMs(k.incl / Math.max(1, k.count))} · ${t('单次最长')} ${fmtMs(k.inclMax)}`}
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

/**
 * 一个计时器的每一次调用（Insights 计时器悬浮提示里的统计 + 时间轴上的「找下一次 / 最慢一次」）：
 * 上面一排次数、最短 / 平均 / 中位 / 最长，下面最慢的 50 次，点一行时间轴跳过去并选中那一块。
 */
export function InstancesView({
  id,
  range,
  timer,
  name,
  laneName,
  actions,
}: {
  id: string
  range?: Range
  timer: number
  name: string
  laneName: (lane: number) => string
  actions: PanelActions
}) {
  const { project } = useUe()
  const res = useDebounced(
    () => traceQuery<Instances>(project.id, id, { what: 'instances', timer, ...range, top: 50 }),
    `${id}|${timer}|${range?.t0}|${range?.t1}`,
    60,
  )
  const d = res.data
  const go = (x: Instances['items'][number]) => {
    actions.zoom(x.start, x.start + x.ms / 1000)
    actions.pickBlock({ lane: x.lane, time: x.start, depth: x.depth, timer, ms: x.ms, name, excl: x.excl })
  }
  return (
    <Section
      className="ue:flex-1"
      title={
        <span className="ue:flex ue:items-center ue:gap-1.5">
          {t('每次调用')}
          <span className="ue:truncate ue:font-normal ue:text-subtle" title={name}>
            · {name}
          </span>
        </span>
      }
    >
      <ErrorText>{res.error}</ErrorText>
      {!d && !res.error && <Skeleton rows={6} />}
      {d && (
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-rise">
          <div className="ue:grid ue:grid-cols-3 ue:gap-x-3 ue:gap-y-1 ue:border-b ue:border-line ue:px-3 ue:py-2 ue:text-caption">
            {(
              [
                [t('次数'), d.count.toLocaleString()],
                [t('包含合计'), fmtMs(d.incl)],
                [t('独占合计'), fmtMs(d.excl)],
                [t('最短'), fmtMs(d.min)],
                [t('平均 / 中位'), `${fmtMs(d.avg)} / ${fmtMs(d.median)}`],
                [t('最长'), fmtMs(d.max)],
              ] as const
            ).map(([k, v]) => (
              <span key={k} className="ue:flex ue:flex-col">
                <span className="ue:text-subtle">{k}</span>
                <span className="ue:font-mono ue:text-fg ue:tabular-nums">{v}</span>
              </span>
            ))}
          </div>
          {!d.items.length && <Empty>{t('这段时间里没调用过它')}</Empty>}
          <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1 ue:text-footnote">
            {d.items.map((x, i) => (
              <button
                key={`${x.lane}-${x.start}`}
                type="button"
                onClick={() => go(x)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: t('在时间轴上跳过去'), icon: Crosshair, onClick: () => go(x) },
                    {
                      label: t('设为分析范围'),
                      icon: Scan,
                      onClick: () => actions.setRange({ t0: x.start, t1: x.start + x.ms / 1000 }),
                    },
                    'sep',
                    {
                      label: t('复制时间'),
                      icon: Copy,
                      onClick: () => copyText(`${laneName(x.lane)} @ ${fmtAt(x.start)} · ${fmtMs(x.ms)}`),
                    },
                  ])
                }
                className="ue:grid ue:w-full ue:grid-cols-[28px_minmax(0,1fr)_64px_64px_56px] ue:items-center ue:gap-2 ue:px-3 ue:py-[3px] ue:text-left ue:transition-colors ue:hover:bg-hover"
              >
                <span className="ue:font-mono ue:text-caption ue:text-subtle">#{i + 1}</span>
                <span className="ue:truncate ue:text-muted">
                  {laneName(x.lane)} <span className="ue:font-mono ue:text-caption ue:text-subtle">@ {fmtAt(x.start)}</span>
                </span>
                <span className="ue:text-right ue:font-mono ue:text-caption ue:text-fg ue:tabular-nums">
                  {fmtMs(x.ms)}
                </span>
                <span className="ue:text-right ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
                  {fmtMs(x.excl)}
                </span>
                <PctBar pct={(x.ms / Math.max(d.max, 1e-6)) * 100} tone={i === 0 ? 'danger' : 'accent'} />
              </button>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}
