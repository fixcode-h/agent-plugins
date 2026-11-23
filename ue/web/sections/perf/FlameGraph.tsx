import { ArrowLeft, Copy, ExternalLink, Search, Target } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { ErrorText, LinkBtn } from '../../ui.tsx'
import { readTheme, useThemeTick, useWidth } from './canvas.ts'
import { LUA_BRIDGE, luaColor, luaFullSource, luaOf, luaSource, useLuaTrace } from './lua-trace.ts'
import { Empty, Segmented, Skeleton, fmtMs, type TreeNode } from './parts.tsx'
import type { PanelActions } from './TracePanels.tsx'
import { blockColor, traceQuery, useDebounced, type Range, type TraceBase } from './trace.ts'

/**
 * 火焰图（Lua 性能 Insights 化设计 5.5；Insights 没有，但最直观）：分析范围内同一条调用路径的作用域合并，
 * 自上而下是调用深度（冰柱式），宽度是包含时间，每格右边的灰格是这个函数自己花的时间。
 * 数据来自 trace.query 的 what=tree（接口约定 9.2）：「从选中的往下」传 root、「全部 Lua」传 luaOnly、「整段」都不传。
 * 点一格 = 选中这个计时器（时间轴高亮、计时器表跟着选中，但留在火焰图）；双击 = 以它为根放大，可以一层层退回。
 * UE 的计时器也能看，不只 Lua。用 div 画：格子数有上限（桥接按 MaxDepth / MaxKids 裁过），点、悬停、右键都直接用 DOM 的事件。
 */
type Mode = 'sel' | 'lua' | 'all'
const ROW = 22

interface Cell {
  n: TreeNode
  x: number
  w: number
  d: number
  /** 自身时间的灰格 */
  self?: boolean
}

export function FlameGraph({
  id,
  range,
  timer,
  actions,
}: {
  id: string
  range?: Range
  timer?: { id: number; name: string }
  actions: PanelActions
}) {
  const { project } = useUe()
  const { cn } = h()
  const lua = useLuaTrace()
  const [mode, setMode] = useState<Mode>(() => (timer ? 'sel' : lua.info.lua ? 'lua' : 'all'))
  // 双击放大的根：一层层记下来，「返回」退一层
  const [stack, setStack] = useState<{ id: number; name: string }[]>(() => (timer ? [timer] : []))
  const [sel, setSel] = useState<TreeNode>()
  // 选中计时器的变化是不是火焰图自己点出来的：自己点的不换根（不然点一格整张图就换了）
  const self = useRef(false)
  useEffect(() => {
    if (self.current) {
      self.current = false
      return
    }
    if (!timer) return
    setStack([timer])
    setMode('sel')
  }, [timer?.id])
  const root = mode === 'sel' ? stack.at(-1) : undefined

  const res = useDebounced(
    mode === 'sel' && !root
      ? undefined
      : () =>
          traceQuery<TraceBase & { root: TreeNode }>(project.id, id, {
            what: 'tree',
            ...range,
            ...(root ? { root: root.id } : {}),
            ...(mode === 'lua' ? { luaOnly: true } : {}),
            ...(lua.mergeC ? { mergeC: true } : {}),
          }),
    `${id}|${mode}|${root?.id}|${range?.t0}|${range?.t1}|${lua.mergeC}`,
    60,
  )
  const top = res.data?.root
  // 换了根或范围：详情里的那格先换成新的根（带 root 时桥接回「全部」下面只挂一个孩子，就是 root 计时器）
  useEffect(
    () =>
      setSel(
        top ? (top.id !== -1 ? top : root && top.children?.length === 1 ? top.children[0] : undefined) : undefined,
      ),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 只跟着回包换
    [top],
  )

  const cells = useMemo(() => (top ? layout(top) : []), [top])
  const depth = cells.reduce((m, c) => Math.max(m, c.d + 1), 0)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- theme 变了重读主题
  const dark = useMemo(() => readTheme().dark, [theme])

  const pick = (n: TreeNode) => {
    setSel(n)
    if (n.id < 0) return
    self.current = n.id !== timer?.id
    actions.selectTimer(n.id, n.name)
  }
  const zoomIn = (n: TreeNode) => {
    if (n.id < 0) return
    setMode('sel')
    setStack((s) => [...(mode === 'sel' ? s : []), { id: n.id, name: n.name }])
  }
  const total = top?.incl ?? 0
  const spanMs = range ? (range.t1 - range.t0) * 1000 : undefined
  const fill = (n: TreeNode) => {
    const x = luaOf(lua, n.id)
    return x ? luaColor(n.name, dark, x.c) : blockColor(n.name, dark)
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:h-9 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:text-caption ue:text-subtle">
        {mode === 'sel' && stack.length > 1 && (
          <LinkBtn onClick={() => setStack((s) => s.slice(0, -1))}>
            <ArrowLeft className="ue:h-3 ue:w-3" /> {stack.at(-2)!.name}
          </LinkBtn>
        )}
        <span className="ue:min-w-0 ue:truncate">
          {range ? t('分析范围') : t('整段')}
          {top && (
            <span className="ue:ml-1.5 ue:font-mono ue:text-fg">
              · {t('共 {ms}', { ms: fmtMs(total) })}
              {spanMs ? ` (${((total / spanMs) * 100).toFixed(0)}%)` : ''}
            </span>
          )}
        </span>
        <span className="ue:ml-auto ue:shrink-0">
          <Segmented<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m)
              if (m === 'sel' && !stack.length && timer) setStack([timer])
            }}
            items={[
              { key: 'sel', label: t('从选中的往下') },
              ...(lua.info.lua ? [{ key: 'lua' as const, label: t('全部 Lua') }] : []),
              { key: 'all', label: t('整段') },
            ]}
          />
        </span>
      </div>
      <ErrorText>
        {res.error && /tree|不认识|unknown/i.test(res.error)
          ? t('火焰图要 UELink {v} 以上：在「UE 插件」页升级 UELink 后重新编译', { v: LUA_BRIDGE })
          : res.error}
      </ErrorText>
      {mode === 'sel' && !root ? (
        <Empty>{t('在计时器表或时间轴上选一个计时器，从它往下看每一层花在哪')}</Empty>
      ) : !top && !res.error ? (
        <Skeleton rows={5} />
      ) : top && !cells.length ? (
        <Empty>{t('这段时间里没有调用')}</Empty>
      ) : (
        top && (
          <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:px-3 ue:py-2">
            <div
              ref={setEl}
              className={cn('ue:relative ue:transition-opacity', res.loading && 'ue:opacity-60')}
              style={{ height: depth * ROW }}
            >
              {w > 0 &&
                cells.map((c, i) => {
                  const px = c.w * w
                  if (px < 1.5) return null
                  const on = !c.self && sel === c.n
                  const src = luaSource(c.n.name, luaOf(lua, c.n.id))
                  return (
                    <div
                      key={i}
                      onClick={() => !c.self && pick(c.n)}
                      onDoubleClick={() => !c.self && zoomIn(c.n)}
                      onContextMenu={(e) =>
                        !c.self &&
                        openMenu(e, [
                          { title: c.n.name },
                          { label: t('以它为根'), icon: Target, hint: t('双击'), onClick: () => zoomIn(c.n) },
                          { label: t('最慢的几次'), icon: Search, onClick: () => actions.slowest(c.n.id, c.n.name) },
                          'sep',
                          { label: t('复制名字'), icon: Copy, onClick: () => copyText(c.n.name) },
                        ])
                      }
                      title={[
                        c.self ? `${c.n.name} · ${t('自身')}` : c.n.name,
                        src,
                        c.self
                          ? fmtMs(c.n.excl ?? 0)
                          : `${t('包含')} ${fmtMs(c.n.incl)} · ${t('自身')} ${fmtMs(c.n.excl ?? 0)} · ${t('次数')} ${c.n.count.toLocaleString()}`,
                      ]
                        .filter(Boolean)
                        .join('\n')}
                      className={cn(
                        'ue:absolute ue:flex ue:items-center ue:gap-1 ue:overflow-hidden ue:rounded-[3px] ue:px-1.5 ue:text-caption ue:whitespace-nowrap',
                        c.self
                          ? 'ue:cursor-default ue:bg-hover ue:text-subtle'
                          : 'ue:cursor-pointer ue:transition-[filter] ue:hover:brightness-110',
                        on && 'ue:ring-2 ue:ring-fg ue:ring-inset',
                      )}
                      style={{
                        left: `${c.x * 100}%`,
                        width: `max(1px, calc(${c.w * 100}% - 2px))`,
                        top: c.d * ROW,
                        height: ROW - 2,
                        background: c.self ? undefined : fill(c.n),
                        color: c.self ? undefined : dark ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.82)',
                      }}
                    >
                      {px > 36 && (
                        <>
                          <span className="ue:truncate">{c.self ? t('（自身）') : c.n.name}</span>
                          {px > 110 && (
                            <span className="ue:shrink-0 ue:font-mono ue:text-[10.5px] ue:opacity-70">
                              {fmtMs(c.self ? (c.n.excl ?? 0) : c.n.incl)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
            </div>
            <div className="ue:mt-2 ue:flex ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
              <span className="ue:inline-block ue:h-2 ue:w-2 ue:rounded-[2px] ue:bg-hover" />
              {t('灰格 = 这个函数自己花的时间（不在任何子调用里）· 点一格选中，双击以它为根')}
            </div>
          </div>
        )
      )}
      {sel && <FlameDetail n={sel} total={total} actions={actions} onRoot={() => zoomIn(sel)} />}
    </div>
  )
}

/** 底部详情：名字、来源、包含 / 自身，打开源码、以它为根、最慢的几次 */
function FlameDetail({
  n,
  total,
  actions,
  onRoot,
}: {
  n: TreeNode
  total: number
  actions: PanelActions
  onRoot: () => void
}) {
  const lua = useLuaTrace()
  const x = luaOf(lua, n.id)
  const full = luaFullSource(x)
  return (
    <div className="ue:shrink-0 ue:border-t ue:border-line ue:px-3 ue:py-2 ue:text-caption">
      <div className="ue:flex ue:items-center ue:gap-1">
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">
          {n.name}
        </span>
        {x && !x.c && (
          <LinkBtn onClick={() => lua.open(x.file, x.line)}>
            <ExternalLink className="ue:h-3 ue:w-3" /> {t('打开源码')}
          </LinkBtn>
        )}
        <LinkBtn onClick={onRoot}>
          <Target className="ue:h-3 ue:w-3" /> {t('以它为根')}
        </LinkBtn>
        <LinkBtn onClick={() => actions.slowest(n.id, n.name)}>{t('最慢的几次')}</LinkBtn>
      </div>
      <div className="ue:mt-1 ue:grid ue:grid-cols-[auto_minmax(0,1fr)] ue:gap-x-4 ue:gap-y-0.5">
        {x && (
          <>
            <span className="ue:text-subtle">{t('来源')}</span>
            <span className="ue:truncate ue:font-mono ue:text-fg">{full || luaSource(n.name, x)}</span>
          </>
        )}
        <span className="ue:text-subtle">{t('包含')}</span>
        <span className="ue:font-mono ue:text-fg">
          {fmtMs(n.incl)}
          {total > 0 && <span className="ue:text-subtle"> ({((n.incl / total) * 100).toFixed(0)}%)</span>}
          <span className="ue:ml-3 ue:text-subtle">{t('自身')}</span> {fmtMs(n.excl ?? 0)}
          <span className="ue:ml-3 ue:text-subtle">{t('次数')}</span> {n.count.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

/**
 * 把树摊成格子：x、w 是占根宽度的比例。根是「全部」（id -1）时不画它自己，从它的孩子画起；
 * 每个有孩子的节点在孩子后面补一格自身时间（灰格），被桥接裁掉的孩子留空。
 */
function layout(root: TreeNode): Cell[] {
  const out: Cell[] = []
  const total = Math.max(root.incl, 1e-9)
  const walk = (n: TreeNode, x: number, d: number) => {
    const w = n.incl / total
    out.push({ n, x, w, d })
    let cx = x
    for (const k of n.children ?? []) {
      walk(k, cx, d + 1)
      cx += k.incl / total
    }
    if (n.children?.length && n.excl) out.push({ n, x: cx, w: n.excl / total, d: d + 1, self: true })
  }
  if (root.id === -1) {
    let cx = 0
    for (const k of root.children ?? []) {
      walk(k, cx, 0)
      cx += k.incl / total
    }
  } else walk(root, 0, 0)
  return out
}
