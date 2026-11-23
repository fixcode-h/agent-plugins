import { ArrowDown, ChevronRight, Copy, Cpu, Filter, GitFork, Highlighter, Layers, Search } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText } from '../../ui.tsx'
import { SearchBox } from '@panel/web/src/components/ui/search-box'
import { copyText, openMenu, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { readTheme, useThemeTick } from './canvas.ts'
import { luaColor, luaFullSource, luaOf, luaSource, useLuaTrace, type LuaTimer } from './lua-trace.ts'
import { Chip } from './LuaToggles.tsx'
import { Empty, Skeleton, fmtMs } from './parts.tsx'
import { traceQuery, useDebounced, type Range, type TimerRow, type TraceBase } from './trace.ts'

type SortKey = 'excl' | 'incl' | 'count' | 'max'
type Col = 'avg' | 'max'

/** 计时器表对外的动作：选中（看调用者 / 被调用者）、找最慢的一次 */
export interface TimerActions {
  onPick: (row: TimerRow) => void
  onSlowest: (row: TimerRow) => void
}

/**
 * 计时器表（Insights 的 Timers）：按类型分组（GPU / CPU，可收起，组头是合计），列是次数、包含、独占，
 * 平均和单次最长可以从右键菜单加上。默认按独占时间倒序；搜索回车才搜，只给前 200 行。
 * 统计跟着分析范围走：帧条或时间轴刻度上拖选一段，这里就只算那一段里的调用。
 */
export function TimersTable({
  id,
  range,
  seconds,
  picked,
  actions,
  rev = -1,
}: {
  id: string
  range?: Range
  seconds: number
  picked?: number
  actions: TimerActions
  /** trace 还在长时由详情页给，一变就重算（没选范围时才看它：选了范围那段数据不会变） */
  rev?: number
}) {
  const { project } = useUe()
  const { cn, ui } = h()
  const [filter, setFilter] = useState('')
  // 从右键菜单填进搜索框时换个 key 让搜索框用新的初始值（平时回车搜不重建，免得丢焦点）
  const [boxKey, setBoxKey] = useState(0)
  const [sort, setSort] = useState<SortKey>('excl')
  const [group, setGroup] = useState<'type' | 'none'>('type')
  const [show, setShow] = useState({ gpu: true, cpu: true })
  const [cols, setCols] = useState<Col[]>([])
  const [closed, setClosed] = useState<string[]>([])
  // Lua（Lua 性能 Insights 化设计 5.4）：只看 Lua 让桥接只回 Lua 计时器（含 C 函数），C 函数并进调用者和时间轴共用一个开关
  const lua = useLuaTrace()
  const hasLua = lua.info.lua
  const [onlyLua, setOnlyLua] = useState(false)
  const luaArgs = hasLua ? { lua: onlyLua || undefined, mergeC: lua.mergeC || undefined } : {}
  const theme = useThemeTick()
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- theme 变了重读主题
  const dark = useMemo(() => readTheme().dark, [theme])
  /** 行上带的来源优先，旧回包没有时查 luainfo */
  const luaRow = (x: TimerRow): LuaTimer | undefined =>
    x.file !== undefined ? { file: x.file, line: x.line ?? 0, c: x.c } : luaOf(lua, x.id)
  const key = `${id}|${range?.t0}|${range?.t1}|${filter}|${sort}|${range ? '' : rev}|${hasLua && onlyLua}|${hasLua && lua.mergeC}`
  const res = useDebounced(
    () =>
      traceQuery<TraceBase & { items: TimerRow[]; total: number; seconds: number }>(project.id, id, {
        what: 'timers',
        ...range,
        filter: filter || undefined,
        sort,
        top: 200,
        ...luaArgs,
      }),
    key,
    80,
  )
  const span = (res.data?.seconds ?? seconds) * 1000
  const items = useMemo(() => (res.data?.items ?? []).filter((x) => (x.gpu ? show.gpu : show.cpu)), [res.data, show])
  const groups = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', list: items }]
    const isLua = (x: TimerRow) => !x.gpu && !!luaRow(x)
    const gpu = items.filter((x) => x.gpu)
    const cpu = items.filter((x) => !x.gpu && !isLua(x))
    return [
      { key: 'lua', label: 'Lua', list: items.filter(isLua) },
      { key: 'gpu', label: 'GPU', list: gpu },
      { key: 'cpu', label: 'CPU', list: cpu },
    ].filter((g) => g.list.length)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- luaRow 只读 lua.info
  }, [items, group, lua.info])
  const grid = `minmax(0,1fr)${hasLua ? ' 92px' : ''} 56px 64px 64px${cols.includes('avg') ? ' 60px' : ''}${cols.includes('max') ? ' 64px' : ''}`
  const toggleCol = (c: Col) => setCols((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))

  const sortItems: MenuItem[] = [
    { title: t('排序') },
    ...(
      [
        ['count', t('按次数')],
        ['incl', t('按包含时间')],
        ['excl', t('按独占时间')],
        ['max', t('按单次最长')],
      ] as const
    ).map(([k, label]) => ({ label, checked: sort === k, onClick: () => setSort(k) })),
    'sep',
    { title: t('列') },
    { label: t('平均'), checked: cols.includes('avg'), onClick: () => toggleCol('avg') },
    { label: t('单次最长'), checked: cols.includes('max'), onClick: () => toggleCol('max') },
    'sep',
    { label: t('按类型分组'), checked: group === 'type', onClick: () => setGroup(group === 'type' ? 'none' : 'type') },
    ...(hasLua
      ? [
          {
            label: t('C 函数并进调用者'),
            checked: lua.mergeC,
            onClick: () => lua.setMergeC(!lua.mergeC),
          },
        ]
      : []),
  ]
  const rowMenu = (e: MouseEvent, x: TimerRow) =>
    openMenu(e, [
      { title: x.name },
      { label: t('看调用者 / 被调用者'), icon: GitFork, onClick: () => actions.onPick(x) },
      { label: t('在时间轴上高亮'), icon: Highlighter, checked: picked === x.id, onClick: () => actions.onPick(x) },
      { label: t('找最慢的一次'), icon: Search, onClick: () => actions.onSlowest(x) },
      {
        label: t('只看名字带它的'),
        icon: Filter,
        onClick: () => {
          setFilter(x.name)
          setBoxKey((k) => k + 1)
        },
      },
      'sep',
      { label: t('复制名字'), icon: Copy, onClick: () => copyText(x.name) },
      {
        label: t('复制这一行'),
        onClick: () =>
          copyText(
            `${x.name}\t${x.count}\t${fmtMs(x.incl)}\t${fmtMs(x.excl)}\t${fmtMs(x.incl / Math.max(1, x.count))}\t${fmtMs(x.inclMax)}`,
          ),
      },
      {
        label: t('复制整张表'),
        onClick: () =>
          copyText(
            [
              ['Name', 'Count', 'Incl (ms)', 'Excl (ms)', 'Avg (ms)', 'Max (ms)'].join('\t'),
              ...items.map((r) =>
                [r.name, r.count, r.incl, r.excl, (r.incl / Math.max(1, r.count)).toFixed(3), r.inclMax].join('\t'),
              ),
            ].join('\n'),
          ),
      },
      'sep',
      ...sortItems,
    ])

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
  const num = 'ue:text-right ue:font-mono ue:text-caption ue:tabular-nums'
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:p-2">
        <div className="ue:min-w-0 ue:flex-1">
          <SearchBox
            key={boxKey}
            initial={filter}
            placeholder={t('按名字筛，回车搜')}
            onSearch={setFilter}
            allowEmpty
            busy={res.loading}
          />
        </div>
        {hasLua && (
          <Chip on={onlyLua} onClick={() => setOnlyLua(!onlyLua)} title={t('只列 Lua 计时器（含 C 函数）')}>
            {t('只看 Lua')}
          </Chip>
        )}
        {(['gpu', 'cpu'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={show[k]}
            title={
              show[k] ? t('隐藏 {k} 计时器', { k: k.toUpperCase() }) : t('显示 {k} 计时器', { k: k.toUpperCase() })
            }
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
            className={cn(
              'ue:rounded-md ue:px-1.5 ue:py-0.5 ue:font-mono ue:text-caption ue:transition-colors',
              show[k] ? 'ue:bg-accent/15 ue:text-accent' : 'ue:bg-hover ue:text-subtle ue:line-through',
            )}
          >
            {k.toUpperCase()}
          </button>
        ))}
        <ui.Select
          size="sm"
          className="ue:w-28"
          value={group}
          onChange={(e: { target: { value: string } }) => setGroup(e.target.value as 'type' | 'none')}
          options={[
            { value: 'type', label: t('按类型分组') },
            { value: 'none', label: t('不分组') },
          ]}
        />
      </div>
      <div
        className="ue:grid ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle"
        style={{ gridTemplateColumns: grid }}
        onContextMenu={(e) => openMenu(e, sortItems)}
      >
        <span className="ue:truncate">
          {t('名字')}
          <span className="ue:ml-1.5 ue:font-mono ue:text-[10.5px]">
            {range ? t('区间 {ms}', { ms: fmtMs(span) }) : t('整段')}
          </span>
        </span>
        {hasLua && <span className="ue:truncate">{t('来源')}</span>}
        {head('count', t('次数'))}
        {head('incl', t('包含'))}
        {head('excl', t('独占'))}
        {cols.includes('avg') && <span className="ue:text-right">{t('平均')}</span>}
        {cols.includes('max') && head('max', t('单次最长'))}
      </div>
      <ErrorText>{res.error}</ErrorText>
      {!res.data && !res.error && <Skeleton rows={8} />}
      {res.data && !items.length && (
        <Empty>{filter ? t('没有名字里带「{q}」的计时器', { q: filter }) : t('这段时间里没有计时器')}</Empty>
      )}
      <div
        className={cn('ue:min-h-0 ue:flex-1 ue:overflow-auto ue:transition-opacity', res.loading && 'ue:opacity-60')}
      >
        {groups.map((g) => {
          const off = closed.includes(g.key)
          const sum = (f: (x: TimerRow) => number) => g.list.reduce((s, x) => s + f(x), 0)
          return (
            <div key={g.key}>
              {g.label && (
                <button
                  type="button"
                  onClick={() => setClosed((c) => (off ? c.filter((x) => x !== g.key) : [...c, g.key]))}
                  className="ue:sticky ue:top-0 ue:z-[1] ue:grid ue:w-full ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-card ue:px-3 ue:py-[3px] ue:text-left ue:text-footnote ue:font-medium ue:text-fg"
                  style={{ gridTemplateColumns: grid }}
                >
                  {/* 组头吸顶：底是实色的卡片色，上面再叠一层悬停色，滚动时下面的行不会透出来 */}
                  <span aria-hidden className="ue:pointer-events-none ue:absolute ue:inset-0 ue:bg-hover" />
                  <span className="ue:relative ue:flex ue:items-center ue:gap-1">
                    <ChevronRight
                      className={cn('ue:h-3 ue:w-3 ue:transition-transform ue:duration-150', !off && 'ue:rotate-90')}
                    />
                    {g.label}
                    <span className="ue:font-normal ue:text-subtle">({g.list.length})</span>
                  </span>
                  {hasLua && <span />}
                  <span className={cn(num, 'ue:relative')}>{sum((x) => x.count).toLocaleString()}</span>
                  <span className={cn(num, 'ue:relative')}>{fmtMs(sum((x) => x.incl))}</span>
                  <span className={cn(num, 'ue:relative')}>{fmtMs(sum((x) => x.excl))}</span>
                  {cols.includes('avg') && <span />}
                  {cols.includes('max') && <span />}
                </button>
              )}
              {!off && (
                <div className="ue:motion-safe:animate-rise">
                  {g.list.map((x) => {
                    const pct = (x.excl / Math.max(span, 1e-6)) * 100
                    const lx = x.gpu ? undefined : luaRow(x)
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => actions.onPick(x)}
                        onDoubleClick={() => actions.onSlowest(x)}
                        onContextMenu={(e) => rowMenu(e, x)}
                        title={[
                          x.name,
                          luaFullSource(lx),
                          `${lx ? 'Lua' : x.gpu ? 'GPU' : 'CPU'} · ${t('次数')} ${x.count.toLocaleString()}`,
                          `${t('包含')} ${fmtMs(x.incl)} · ${t('独占')} ${fmtMs(x.excl)}（${pct.toFixed(1)}%）`,
                          `${t('平均')} ${fmtMs(x.incl / Math.max(1, x.count))} · ${t('单次最长')} ${fmtMs(x.inclMax)}`,
                          t('双击找最慢的一次，右键更多'),
                        ]
                          .filter(Boolean)
                          .join('\n')}
                        className={cn(
                          'ue:relative ue:grid ue:w-full ue:items-center ue:gap-2 ue:px-3 ue:py-[3px] ue:text-left ue:text-footnote ue:transition-colors',
                          picked === x.id ? 'ue:bg-sel' : 'ue:hover:bg-hover',
                        )}
                        style={{ gridTemplateColumns: grid }}
                      >
                        {/* 行底一条淡的占比条：独占时间占范围的比例，扫一眼就知道谁最重 */}
                        <span
                          aria-hidden
                          className="ue:pointer-events-none ue:absolute ue:inset-y-0 ue:left-0 ue:bg-accent/8 ue:transition-[width] ue:duration-300"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                        <span className="ue:relative ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:pl-4">
                          {lx ? (
                            <span
                              className="ue:h-2.5 ue:w-2.5 ue:shrink-0 ue:rounded-[2px]"
                              style={{ background: luaColor(x.name, dark, lx.c) }}
                            />
                          ) : x.gpu ? (
                            <Layers className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-run" />
                          ) : (
                            <Cpu className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                          )}
                          <span className="ue:truncate ue:text-fg">{x.name}</span>
                        </span>
                        {hasLua && <SourceCell name={x.name} x={lx} open={lua.open} />}
                        <span className={cn(num, 'ue:relative ue:text-subtle')}>{x.count.toLocaleString()}</span>
                        <span className={cn(num, 'ue:relative ue:text-muted')}>{fmtMs(x.incl)}</span>
                        <span className={cn(num, 'ue:relative ue:text-fg')}>{fmtMs(x.excl)}</span>
                        {cols.includes('avg') && (
                          <span className={cn(num, 'ue:relative ue:text-subtle')}>
                            {fmtMs(x.incl / Math.max(1, x.count))}
                          </span>
                        )}
                        {cols.includes('max') && (
                          <span className={cn(num, 'ue:relative ue:text-subtle')}>{fmtMs(x.inclMax)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {res.data && res.data.total > (res.data.items.length ?? 0) && (
          <div className="ue:px-3 ue:py-2 ue:text-caption ue:text-subtle">
            {t('共 {n} 个，只列前 {m} 个：用搜索找其余的', { n: res.data.total, m: res.data.items.length })}
          </div>
        )}
      </div>
    </div>
  )
}

/** 来源格：Lua 函数是可点的「文件:行」（打开 .lua），C 函数写「C · UE 接口 / Lua 库」，UE 计时器空着 */
function SourceCell({ name, x, open }: { name: string; x?: LuaTimer; open: (file: string, line?: number) => void }) {
  if (!x) return <span />
  if (x.c) return <span className="ue:relative ue:truncate ue:text-caption ue:text-subtle">{luaSource(name, x)}</span>
  return (
    <span
      role="link"
      tabIndex={-1}
      title={t('在编辑器里打开 {f}', { f: luaFullSource(x) })}
      onClick={(e) => {
        // 行本身点了是选中计时器：这里只打开文件
        e.stopPropagation()
        open(x.file, x.line)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="ue:relative ue:truncate ue:font-mono ue:text-caption ue:text-accent-text ue:hover:underline"
    >
      {luaSource(name, x)}
    </span>
  )
}
