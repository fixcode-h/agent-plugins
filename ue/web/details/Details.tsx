import { FoldVertical, Search, UnfoldVertical, X } from 'lucide-react'
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { Collapse } from './controls.tsx'
import { buildGroups, keep, matches, remember, type Group, type Prop } from './model.ts'
import { CategoryBar, DetailsCtx, Row, nodeOf, type DetailsApi } from './rows.tsx'

const INTERNAL = '__internal'
const CHANGED = '__changed'

/** 分类折叠状态记在本机（UE 也记），所有对象共用：收起过「渲染」，下个对象的「渲染」也收着 */
const openState = remember<Record<string, boolean>>('open', {})
function useOpen() {
  const [open, setOpen] = useState(openState)
  // 分类默认展开；「高级」和内部状态默认收起（UE 的高级区默认也是收着的）
  const isOpen = (key: string, def = true) => open[key] ?? def
  const set = (next: Record<string, boolean>) => {
    Object.assign(openState, next)
    keep('open', openState)
    setOpen({ ...openState })
  }
  return { isOpen, toggle: (key: string, def = true) => set({ [key]: !isOpen(key, def) }), set }
}

/** 名字列宽（UE 细节面板中间那道分隔线可以拖），记在本机 */
function useNameWidth() {
  const [w, setW] = useState(() => remember<number>('nameW', 0))
  return {
    css: w ? `${w}px` : '38%',
    set: setW,
    save: (n: number) => keep('nameW', n),
    reset: () => {
      setW(0)
      keep('nameW', 0)
    },
  }
}

/** 按搜索词留下命中的属性；分类名命中时整类留下。返回 null 是这一类整个没命中 */
function filterGroup(g: Group, q: string, keepAll = false): Group | null {
  if (!q) return g
  const hitTitle = keepAll || g.title.toLowerCase().includes(q.toLowerCase())
  const props = hitTitle ? g.props : g.props.filter((p) => matches(p, q))
  const advanced = hitTitle ? g.advanced : g.advanced.filter((p) => matches(p, q))
  const subs = g.subs.map((s) => filterGroup(s, q, hitTitle)).filter((s): s is Group => !!s)
  return props.length || advanced.length || subs.length ? { ...g, props, advanced, subs } : null
}

const countOf = (g: Group): number => g.props.length + g.advanced.length + g.subs.reduce((n, s) => n + countOf(s), 0)

/**
 * 细节面板（照 UE 的「细节」）：顶上搜索（打字就筛，属性列表已经在网页里了，不再发请求）和分类按钮（所有 / 各分类 / 改过的），
 * 下面按分类一条条折叠条，分类里先列平常的属性，最后是收着的「高级」；UE 细节面板里不出现的内部状态单独一组放最后。
 * 每行左边显示名、右边按类型的控件，中间的分隔线能拖动调名字列宽，双击恢复
 */
export function Details({
  props,
  api,
  loading,
  top,
  footer,
}: {
  props: Prop[]
  api: Omit<DetailsApi, 'q'>
  loading?: boolean
  /** 放在所有分类前面的块（Actor 的「变换」） */
  top?: (q: string) => ReactNode
  footer?: ReactNode
}) {
  const { cn, ui } = h()
  const [q, setQ] = useState('')
  const [chip, setChip] = useState('')
  const open = useOpen()
  const name = useNameWidth()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; w: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const { roots, internal } = useMemo(() => buildGroups(props), [props])
  const changedProps = props.filter((p) => api.isChanged(p.name))
  // 分类按钮只按第一层分类；选中的分类没了（换了对象）就回到「所有」
  const cur = chip === CHANGED || chip === INTERNAL || roots.some((g) => g.key === chip) ? chip : ''
  const query = q.trim()
  const shown = useMemo(() => {
    const base =
      cur === CHANGED
        ? buildGroups(changedProps.map((p) => ({ ...p, edit: true }))).roots
        : cur === INTERNAL
          ? []
          : roots.filter((g) => !cur || g.key === cur)
    return base.map((g) => filterGroup(g, query)).filter((g): g is Group => !!g)
    // changedProps 跟着 props 和 api.version 变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, cur, query, props, api.version])
  const internalShown = cur === '' || cur === INTERNAL ? internal.filter((p) => matches(p, query)) : []
  const all = [...shown.map((g) => g.key), ...(internalShown.length ? [INTERNAL] : [])]
  const anyOpen = all.some((k) => open.isOpen(k, k !== INTERNAL))
  const ctx: DetailsApi = { ...api, q: query }
  // 搜索时全部展开（含高级和内部），清掉搜索回到原来的折叠状态
  const force = !!query

  const group = (g: Group, depth: number): ReactNode => {
    const isOpen = force || open.isOpen(g.key)
    const advKey = `${g.key}#adv`
    const advOpen = force || open.isOpen(advKey, false)
    return (
      <section key={g.key}>
        <CategoryBar
          title={g.title}
          open={isOpen}
          depth={depth}
          count={countOf(g)}
          q={query}
          onToggle={() => open.toggle(g.key)}
        />
        <Collapse open={isOpen}>
          {g.props.map((p) => (
            <Row key={p.name} n={nodeOf(p)} depth={depth} />
          ))}
          {g.subs.map((s) => group(s, depth + 1))}
          {g.advanced.length > 0 && (
            <>
              <CategoryBar
                title={t('高级')}
                open={advOpen}
                depth={depth + 1}
                count={g.advanced.length}
                q=""
                onToggle={() => open.toggle(advKey, false)}
              />
              <Collapse open={advOpen}>
                {g.advanced.map((p) => (
                  <Row key={p.name} n={nodeOf(p)} depth={depth + 1} />
                ))}
              </Collapse>
            </>
          )}
        </Collapse>
      </section>
    )
  }

  const chipCls = (on: boolean, tone?: 'accent') =>
    cn(
      'ue:inline-flex ue:h-6 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:border ue:px-2.5 ue:text-footnote ue:transition-colors',
      on
        ? 'ue:border-accent ue:bg-accent ue:text-on-accent'
        : cn(
            'ue:border-line ue:bg-field ue:hover:border-line-strong ue:hover:text-fg',
            tone ? 'ue:text-accent-text' : 'ue:text-muted',
          ),
    )

  return (
    <DetailsCtx.Provider value={ctx}>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2">
        <div className="ue:flex ue:items-center ue:gap-1.5">
          <label className="ue:flex ue:h-7 ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:border ue:border-line ue:bg-field ue:px-2 ue:transition-colors ue:focus-within:border-focus">
            <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('')
              }}
              placeholder={t('搜索')}
              aria-label={t('搜索属性')}
              className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-footnote ue:text-fg ue:outline-none ue:placeholder:text-subtle"
            />
            {q && (
              <button
                type="button"
                aria-label={t('清空搜索')}
                onClick={() => setQ('')}
                className="ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
              >
                <X className="ue:h-3.5 ue:w-3.5" />
              </button>
            )}
          </label>
          <ui.IconButton
            icon={anyOpen ? FoldVertical : UnfoldVertical}
            label={anyOpen ? t('全部收起') : t('全部展开')}
            size="sm"
            onClick={() => open.set(Object.fromEntries(all.map((k) => [k, !anyOpen])))}
          />
        </div>
        {(roots.length > 1 || internal.length > 0 || changedProps.length > 0) && (
          <nav aria-label={t('属性分类')} className="ue:flex ue:flex-wrap ue:gap-1">
            <button type="button" className={chipCls(cur === '')} onClick={() => setChip('')}>
              {t('所有')}
            </button>
            {roots.map((g) => (
              <button
                key={g.key}
                type="button"
                className={chipCls(cur === g.key)}
                aria-current={cur === g.key ? 'true' : undefined}
                onClick={() => setChip(cur === g.key ? '' : g.key)}
              >
                {g.title}
              </button>
            ))}
            {internal.length > 0 && (
              <button
                type="button"
                className={chipCls(cur === INTERNAL)}
                title={t('UE 细节面板里不显示的内部状态（没有 EditAnywhere 这类标记），排查时常要看')}
                onClick={() => setChip(cur === INTERNAL ? '' : INTERNAL)}
              >
                {t('内部')}
              </button>
            )}
            {changedProps.length > 0 && (
              <button
                type="button"
                className={chipCls(cur === CHANGED, 'accent')}
                onClick={() => setChip(cur === CHANGED ? '' : CHANGED)}
              >
                {t('改过的')} <span className="ue:text-caption ue:opacity-80">{changedProps.length}</span>
              </button>
            )}
          </nav>
        )}
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        <div ref={box} className="ue:relative" style={{ '--ue-name-w': name.css } as CSSProperties}>
          {loading && !props.length && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>}
          {!cur && top?.(query)}
          {shown.map((g) => group(g, 0))}
          {internalShown.length > 0 && (
            <section>
              <CategoryBar
                title={t('内部状态（UE 细节面板不显示）')}
                open={force || cur === INTERNAL || open.isOpen(INTERNAL, false)}
                count={internalShown.length}
                q=""
                onToggle={() => open.toggle(INTERNAL, false)}
              />
              <Collapse open={force || cur === INTERNAL || open.isOpen(INTERNAL, false)}>
                {internalShown.map((p) => (
                  <Row key={p.name} n={nodeOf(p)} />
                ))}
              </Collapse>
            </section>
          )}
          {!loading && props.length > 0 && !shown.length && !internalShown.length && (
            <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
              {cur === CHANGED ? t('这次还没有改过的属性') : t('没有匹配「{q}」的属性', { q: query })}
            </p>
          )}
          {!loading && !props.length && (
            <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('这个对象没有属性')}</p>
          )}
          {/* 名字列和值列中间的分隔线：整列高，按住左右拖，双击恢复默认 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('拖动调整名字列宽度')}
            title={t('拖动调整名字列宽度，双击恢复默认')}
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              const nameCell = box.current?.querySelector('[data-name-cell]') as HTMLElement | null
              drag.current = { x: e.clientX, w: nameCell?.getBoundingClientRect().width ?? 240 }
              setDragging(true)
            }}
            onPointerMove={(e) => {
              const s = drag.current
              const max = (box.current?.clientWidth ?? 800) - 160
              if (s) name.set(Math.max(120, Math.min(max, s.w + e.clientX - s.x)))
            }}
            onPointerUp={(e) => {
              const s = drag.current
              if (!s) return
              drag.current = null
              setDragging(false)
              const max = (box.current?.clientWidth ?? 800) - 160
              const n = Math.max(120, Math.min(max, s.w + e.clientX - s.x))
              name.set(n)
              name.save(n)
            }}
            onDoubleClick={name.reset}
            style={{ left: `calc(${name.css} - 3px)` }}
            className="ue:group ue:absolute ue:inset-y-0 ue:z-10 ue:w-[7px] ue:cursor-col-resize"
          >
            <span
              className={cn(
                'ue:absolute ue:inset-y-0 ue:left-[3px] ue:w-px ue:transition-colors',
                dragging ? 'ue:bg-accent' : 'ue:group-hover:bg-accent/60',
              )}
            />
            {dragging && <span className="ue:fixed ue:inset-0 ue:z-50 ue:cursor-col-resize" />}
          </div>
        </div>
      </div>
      {footer}
    </DetailsCtx.Provider>
  )
}
