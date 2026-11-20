import { ChevronRight, Crosshair, Loader2, Search } from 'lucide-react'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  comparable,
  type GtPropGroup,
  type GtPropItem,
  type GtPropsResult,
} from '../../../../shared/gt-script/index.ts'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { stateHint, stateOfProp } from './compare-table.ts'
import { classShort } from './describe.ts'
import { useColWidths, usePrefs } from './prefs.ts'

/** 两种用法：标识（多选，点准星加进标识组 / 再点移出）、判断（单选，选要判断的那个属性） */
export type PropTreeMode = 'ident' | 'judge'

const SRC_LABEL: Record<GtPropItem['src'], () => string> = {
  cpp: () => 'C++',
  bp: () => t('蓝图'),
  lua: () => 'Lua',
  state: () => t('状态'),
}
const SRC_TONE: Record<GtPropItem['src'], string> = {
  cpp: 'ue:bg-accent/10 ue:text-accent',
  bp: 'ue:bg-run/10 ue:text-run',
  lua: 'ue:bg-warning/10 ue:text-warning',
  state: 'ue:bg-hover ue:text-muted',
}

/** C++ / 蓝图 / Lua / 状态的小标签 */
export function SrcTag({ src, n }: { src: GtPropItem['src']; n?: number }) {
  const { cn } = h()
  return (
    <span className={cn('ue:shrink-0 ue:rounded-sm ue:px-1 ue:py-px ue:text-caption', SRC_TONE[src])}>
      {SRC_LABEL[src]()}
      {n !== undefined && ` · ${n}`}
    </span>
  )
}

/** 「同类里」一列：各不相同 / N 种 / 都一样 / 会变 / 不能比 */
function siblingText(it: GtPropItem, siblings: number | undefined): { text: string; tone: string } {
  if (it.comparable === false) return { text: t('不能比'), tone: 'ue:text-subtle' }
  if (it.changing) return { text: t('会变'), tone: 'ue:text-warning' }
  if (it.distinct === undefined) return { text: '', tone: '' }
  if (siblings !== undefined && siblings > 1 && it.distinct >= siblings)
    return { text: t('各不相同'), tone: 'ue:text-success' }
  if (it.distinct <= 1) return { text: t('都一样'), tone: 'ue:text-subtle' }
  return { text: t('{n} 种', { n: it.distinct }), tone: 'ue:text-muted' }
}

/** 能不能当标识 / 被判断：委托、指针、结构体本身不行（灰掉，悬停看原因） */
const usable = (it: GtPropItem) => it.comparable !== false && comparable(it.kind)

type PartState = GtPropGroup[] | 'loading' | { error: string }

/**
 * 属性树（设计稿第 5 节、效果图 2）：标识和判断共用。按组列出对象自己的属性（C++ / 蓝图 / Lua 标签）、条目的数据对象、
 * 各部件（嵌套界面展开时再按 part 读一次）、算出状态；每行名字、类型、此刻的值、同类里、准星。
 * 推荐的行准星用主色，会变的标黄，不能比的灰掉并写原因。列宽拖表头的竖线改，记在本机
 */
export function PropTree({
  data,
  mode,
  selected,
  onPick,
  loadPart,
  loading,
  error,
  toolbar,
  className,
}: {
  /** unavailable：UE 读不到（旧 GameTest、编辑器没开）时服务端只给 Lua 声明字段，这里写原因 */
  data?: GtPropsResult & { unavailable?: string; luaFile?: string }
  mode: PropTreeMode
  /** 已选的属性路径（标识组里的、判断选中的那个） */
  selected: string[]
  onPick: (it: GtPropItem) => void
  /** 展开嵌套界面时按部件读它的属性；不给时嵌套界面不能展开 */
  loadPart?: (part: string) => Promise<GtPropGroup[] | undefined>
  loading?: boolean
  error?: string
  /** 工具条右边额外的按钮（「从游戏里抓」） */
  toolbar?: ReactNode
  className?: string
}) {
  const { ui, cn } = h()
  const [prefs, setPrefs] = usePrefs()
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [parts, setParts] = useState<Record<string, PartState>>({})
  const cols = useColWidths('gt-proptree', { name: 220, type: 130, sib: 84 })
  const live = !!data?.groups.some((g) => g.items.some((i) => i.value !== undefined))
  const showSib = live && prefs.siblings && data?.siblings !== undefined
  const sel = new Set(selected)
  const suggest = new Set(data?.suggest ?? [])
  const k = q.trim().toLowerCase()
  const keep = (it: GtPropItem) =>
    (!prefs.onlyIdent || usable(it)) &&
    (!k || it.name.toLowerCase().includes(k) || it.prop.toLowerCase().includes(k) || it.type.toLowerCase().includes(k))

  // 名字、类型列按拖出来的宽度，窄的时候（检查器、示例）先压它们，准星列和值列总在
  const template = [
    `minmax(96px,${cols.w.name}px)`,
    `minmax(56px,${cols.w.type}px)`,
    ...(live ? [`minmax(48px,1fr)`] : ['minmax(0,1fr)']),
    ...(showSib ? [`minmax(48px,${cols.w.sib}px)`] : []),
    '32px',
  ].join(' ')
  const gridStyle: CSSProperties = { gridTemplateColumns: template, height: prefs.rowH }

  const toggleGroup = async (g: GtPropGroup, key: string) => {
    const open = closed.has(key) || (g.collapsed && !parts[key])
    setClosed((s) => {
      const n = new Set(s)
      if (open) n.delete(key)
      else n.add(key)
      return n
    })
    // 嵌套界面第一次展开：按部件再读一次（协议 7.3：items 为空，面板展开时用 part 调）
    if (open && g.collapsed && g.part && loadPart && !parts[key]) {
      setParts((p) => ({ ...p, [key]: 'loading' }))
      try {
        const groups = (await loadPart(g.part)) ?? []
        setParts((p) => ({ ...p, [key]: groups }))
      } catch (e) {
        setParts((p) => ({ ...p, [key]: { error: (e as Error).message } }))
      }
    }
  }

  const row = (it: GtPropItem, depth: number, key: string) => {
    const on = sel.has(it.prop)
    const ok = usable(it)
    const rec = ok && (suggest.has(it.prop) || (it.score ?? 0) >= 7)
    const sib = siblingText(it, data?.siblings)
    const state = stateOfProp(it.prop)
    return (
      <div
        key={key}
        role="row"
        aria-selected={on}
        title={!ok ? (it.why ?? t('这种类型不能比')) : state ? stateHint(state) : it.note}
        style={gridStyle}
        onClick={() => ok && onPick(it)}
        className={cn(
          'ue:grid ue:items-center ue:gap-2 ue:border-b ue:border-line/40 ue:pr-1 ue:text-footnote',
          ok ? 'ue:cursor-pointer ue:hover:bg-hover' : 'ue:opacity-55',
          on && 'ue:bg-accent/8',
        )}
      >
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5" style={{ paddingLeft: 10 + depth * 14 }}>
          <span className="ue:truncate ue:font-mono ue:text-fg">{it.name}</span>
          {it.src !== 'state' && depth === 0 && <SrcTag src={it.src} />}
        </span>
        <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={it.type}>
          {it.type}
        </span>
        <span className="ue:truncate ue:font-mono ue:text-fg" title={live ? show(it.value) : undefined}>
          {live ? (it.value === undefined ? '—' : show(it.value)) : ''}
        </span>
        {showSib && <span className={cn('ue:truncate ue:text-caption', sib.tone)}>{sib.text}</span>}
        <span className="ue:flex ue:justify-center">
          {ok && (
            <button
              type="button"
              aria-pressed={on}
              aria-label={mode === 'ident' ? t('当标识') : t('判断这个')}
              onClick={(e) => {
                e.stopPropagation()
                onPick(it)
              }}
              className={cn(
                'ue:flex ue:h-6 ue:w-6 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-md',
                on
                  ? 'ue:bg-accent ue:text-on-accent'
                  : it.changing
                    ? 'ue:text-warning ue:hover:bg-warning/10'
                    : rec
                      ? 'ue:text-accent ue:hover:bg-accent/10'
                      : 'ue:text-subtle ue:hover:bg-hover ue:hover:text-fg',
              )}
            >
              <Crosshair className="ue:h-3.5 ue:w-3.5" />
            </button>
          )}
        </span>
      </div>
    )
  }

  const group = (g: GtPropGroup, depth: number, prefix: string): ReactNode => {
    const key = `${prefix}${g.id}`
    const nested = parts[key]
    const open = !closed.has(key) && (!g.collapsed || !!nested)
    const items = g.items.filter(keep)
    const srcCount = g.id === 'self' ? countSrc(g.items) : undefined
    // 搜索时没有命中的组整组藏起来（嵌套界面还没展开的留着，里面可能有）
    if (k && !items.length && !g.collapsed && !Array.isArray(nested)) return null
    return (
      <div key={key} role="rowgroup">
        <button
          type="button"
          onClick={() => void toggleGroup(g, key)}
          className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:border-b ue:border-line/40 ue:pr-3 ue:text-left ue:text-footnote ue:hover:bg-hover"
          style={{ height: prefs.rowH, paddingLeft: 4 + depth * 14 }}
        >
          <ChevronRight
            className={cn(
              'ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle ue:transition-transform',
              open && 'ue:rotate-90',
            )}
          />
          <span className={cn('ue:truncate ue:text-fg', g.part ? 'ue:font-mono' : 'ue:font-medium')}>{g.title}</span>
          {g.class && (
            <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{classShort(g.class)}</span>
          )}
          {g.user && !open && (
            <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('嵌套界面，展开看里面')}</span>
          )}
          {srcCount && (
            <span className="ue:flex ue:items-center ue:gap-1">
              {(['cpp', 'bp', 'lua'] as const)
                .filter((s) => srcCount[s])
                .map((s) => (
                  <SrcTag key={s} src={s} n={srcCount[s]} />
                ))}
            </span>
          )}
          <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">
            {nested === 'loading' ? (
              <Loader2 className="ue:h-3 ue:w-3 ue:animate-spin" />
            ) : g.collapsed ? (
              ''
            ) : (
              t('{n} 项', { n: g.items.length })
            )}
          </span>
        </button>
        {open && items.map((it) => row(it, depth + 1, `${key}/${it.prop}`))}
        {open && Array.isArray(nested) && nested.map((ng) => group(ng, depth + 1, `${key}>`))}
        {open && nested && typeof nested === 'object' && 'error' in nested && (
          <p className="ue:px-3 ue:py-1 ue:text-caption ue:text-danger" style={{ paddingLeft: 24 + depth * 14 }}>
            {nested.error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={cn('ue:flex ue:min-h-0 ue:flex-col', className)}>
      <div className="ue:flex ue:shrink-0 ue:items-center ue:gap-2 ue:px-2 ue:py-1.5">
        <div className="ue:relative ue:min-w-0 ue:flex-1">
          <Search className="ue:pointer-events-none ue:absolute ue:top-1/2 ue:left-2 ue:h-3.5 ue:w-3.5 ue:-translate-y-1/2 ue:text-subtle" />
          <ui.Input
            size="sm"
            className="ue:w-full ue:pl-7"
            placeholder={t('搜属性')}
            value={q}
            onChange={(e: { target: { value: string } }) => setQ(e.target.value)}
          />
        </div>
        <label className="ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
          <input
            type="checkbox"
            className="ue:accent-accent"
            checked={prefs.onlyIdent}
            onChange={(e) => setPrefs({ onlyIdent: e.target.checked })}
          />
          {mode === 'ident' ? t('只看能当标识的') : t('只看能判断的')}
        </label>
        {toolbar}
      </div>
      <Head cols={cols} live={live} showSib={showSib} siblings={data?.siblings} template={template} />
      <div role="table" className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {loading && !data && (
          <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        )}
        {error && <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-danger">{error}</p>}
        {data?.unavailable ? (
          <p className="ue:border-b ue:border-line/40 ue:px-3 ue:py-1.5 ue:text-caption ue:text-warning">
            {t('只列出了 Lua 源码里声明的字段：{why}', { why: data.unavailable })}
          </p>
        ) : (
          data &&
          !live && (
            <p className="ue:border-b ue:border-line/40 ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle">
              {t('游戏没开：按类读资产列出属性，没有此刻的值和「同类里」')}
            </p>
          )
        )}
        {data?.groups.map((g) => group(g, 0, ''))}
        {data?.truncated && (
          <p className="ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle">
            {t('属性太多只列了前面一部分，搜一下找更多')}
          </p>
        )}
        {!loading && !error && !data && (
          <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
            {t('先填类，或从游戏里抓一个')}
          </p>
        )}
      </div>
    </div>
  )
}

function countSrc(items: GtPropItem[]) {
  const c: Partial<Record<GtPropItem['src'], number>> = {}
  for (const i of items) c[i.src] = (c[i.src] ?? 0) + 1
  return c
}

/** 表头：每列右边一道能拖的竖线（双击恢复默认宽度） */
function Head({
  cols,
  live,
  showSib,
  siblings,
  template,
}: {
  cols: ReturnType<typeof useColWidths>
  live: boolean
  showSib: boolean
  siblings?: number
  template: string
}) {
  const heads: [string | undefined, string][] = [
    ['name', t('属性')],
    ['type', t('类型')],
    [undefined, live ? t('此刻的值') : ''],
    ...(showSib ? ([['sib', t('同类 {n} 个里', { n: siblings ?? 0 })]] as [string, string][]) : []),
    [undefined, ''],
  ]
  return (
    <div
      role="row"
      style={{ gridTemplateColumns: template }}
      className="ue:grid ue:h-7 ue:shrink-0 ue:items-center ue:gap-2 ue:border-y ue:border-line ue:pr-1 ue:text-caption ue:text-subtle"
    >
      {heads.map(([col, label], i) => (
        <span
          key={i}
          className="ue:relative ue:flex ue:h-full ue:min-w-0 ue:items-center ue:truncate"
          style={i === 0 ? { paddingLeft: 10 } : undefined}
        >
          {label}
          {col && (
            <ColGrip
              onDrag={(dx, base) => cols.set(col, base + dx)}
              base={() => cols.w[col]}
              onEnd={cols.commit}
              onReset={() => cols.reset(col)}
            />
          )}
        </span>
      ))}
    </div>
  )
}

/** 列宽拖动条：按下记住起点宽度，拖动时按位移改 */
function ColGrip({
  onDrag,
  base,
  onEnd,
  onReset,
}: {
  onDrag: (dx: number, base: number) => void
  base: () => number
  onEnd: () => void
  onReset: () => void
}) {
  const start = useRef<{ x: number; w: number } | null>(null)
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title={t('拖动调整宽度，双击恢复默认')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: base() }
      }}
      onPointerMove={(e) => start.current && onDrag(e.clientX - start.current.x, start.current.w)}
      onPointerUp={() => {
        start.current = null
        onEnd()
      }}
      onDoubleClick={onReset}
      className="ue:group ue:absolute ue:inset-y-0 ue:-right-[5px] ue:z-10 ue:w-[7px] ue:cursor-col-resize"
    >
      <span className="ue:absolute ue:inset-y-1 ue:left-[3px] ue:w-px ue:bg-line ue:group-hover:bg-accent/60" />
    </span>
  )
}
