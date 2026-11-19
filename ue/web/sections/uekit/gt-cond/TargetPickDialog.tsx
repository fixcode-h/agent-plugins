import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Crosshair, CornerDownRight, LayoutTemplate } from 'lucide-react'
import { op } from '../../../api.ts'
import { ASSET_KINDS } from '../../../asset-icons.ts'
import { h, t } from '../../../host.ts'
import { useSearchIndex } from '../../../jump/index-data.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { PickDialog } from '../gt-live/PickDialog.tsx'
import { selectorLabel } from '../gt-selector-label.ts'
import { matchWidgets, type WidgetHit } from '../gt-widget-match.ts'

/** gt.widgets 回来的一个控件（GameTest 1.9，读 WBP 资产的 WidgetTree，不用开游戏） */
interface WNode {
  name: string
  class: string
  selector: string
  depth: number
  isVariable?: boolean
  text?: string
  userWidget?: boolean
}

/** 进到嵌套 WBP 里的一层：前缀是外层那个控件的选择器，里面的路径用 `>` 接上 */
interface Hop {
  label: string
  args: Record<string, unknown>
  prefix?: string
}

/** 嵌套 WBP 里的选择器接到外层后面：`外层选择器>里面的路径`（里面那份回包带自己的屏名，去掉） */
const join = (prefix: string | undefined, sel: string) => {
  if (!prefix) return sel
  const i = sel.indexOf(':')
  return `${prefix}>${i >= 0 ? sel.slice(i + 1) : sel}`
}

/**
 * 选控件的弹窗（用户 2026-11-19：输入框里下拉操作空间太小，直接弹窗选）。
 * 左边按名字搜控件蓝图（本地索引，不碰 UE），右边是选中界面的控件树（编辑器开着时读资产，不用开游戏）；
 * 点界面本身是「整个界面」，点树里的控件是它的选择器；嵌套的 WBP 可以进去接着选。
 * 最上面的框能直接改选择器（$item>Btn 这种也在这写），编辑器开着时还能「从游戏里抓」
 */
export function TargetPickDialog({
  value,
  onClose,
  onPick,
}: {
  value: string
  onClose: () => void
  onPick: (v: string) => void
}) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const index = useSearchIndex(ctx.project)
  const [sel, setSel] = useState(value)
  const screen = value.includes(':') && !value.startsWith('$') ? value.slice(0, value.indexOf(':')) : ''
  const [q, setQ] = useState(screen)
  const [wbp, setWbp] = useState<WidgetHit>()
  const [hops, setHops] = useState<Hop[]>([])
  const [filter, setFilter] = useState('')
  const [tree, setTree] = useState<{ nodes?: WNode[]; error?: string; loading?: boolean }>({})
  const [grabbing, setGrabbing] = useState(false)

  const list = useMemo(() => matchWidgets(index.idx, q, 200), [index.idx, q])
  // 打开时框里已经有「界面:路径」：直接选中那个界面，右边出它的控件树
  useEffect(() => {
    if (wbp || !screen || !index.idx) return
    const hit = matchWidgets(index.idx, screen, 20).rows.find((r) => r.name === screen || r.value === screen)
    if (hit) choose(hit, false)
    // 只在索引到了时认一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [index.idx])

  const hop = hops[hops.length - 1]
  useEffect(() => {
    if (!hop) return setTree({})
    if (!ctx.live) return setTree({ error: t('编辑器没开：读不了控件树。可以选整个界面，或在上面直接写路径') })
    let live = true
    setTree({ loading: true })
    op<{ nodes?: WNode[] }>(ctx.project, 'gt.widgets', { ...hop.args, limit: 400 })
      .then((r) => live && setTree({ nodes: r.nodes ?? [] }))
      .catch((e: Error) => live && setTree({ error: e.message }))
    return () => {
      live = false
    }
  }, [hop, ctx.live, ctx.project])

  function choose(w: WidgetHit, setValue = true) {
    setWbp(w)
    setFilter('')
    setHops([{ label: w.name, args: { asset: `${w.pkg}.${w.name}` } }])
    if (setValue) setSel(`${w.value}:.`)
  }

  const shown = useMemo(() => {
    const k = filter.trim().toLowerCase()
    const all = tree.nodes ?? []
    return k ? all.filter((n) => `${n.name} ${n.class} ${n.text ?? ''}`.toLowerCase().includes(k)) : all
  }, [tree.nodes, filter])
  const { icon: WbpIcon } = ASSET_KINDS['umg-widget']

  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('选控件')}
      description={t('左边找界面，右边点控件；也可以直接改最上面的选择器')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button onClick={() => onPick(sel.trim())}>{t('用这个')}</ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <div className="ue:flex ue:items-center ue:gap-2">
          <ui.Input
            size="sm"
            spellCheck={false}
            className="ue:min-w-0 ue:flex-1 ue:font-mono"
            value={sel}
            placeholder={t('界面:路径，例如 WBP_Shop:Root/BtnBuy')}
            onChange={(e: { target: { value: string } }) => setSel(e.target.value)}
          />
          {ctx.live && (
            <ui.Button size="sm" variant="secondary" onClick={() => setGrabbing(true)}>
              <Crosshair className="ue:h-3.5 ue:w-3.5" />
              {t('从游戏里抓')}
            </ui.Button>
          )}
        </div>
        {sel.trim() && selectorLabel(sel.trim()) !== sel.trim() && (
          <p className="ue:text-caption ue:text-subtle">{selectorLabel(sel.trim())}</p>
        )}
        <div className="ue:grid ue:h-[52vh] ue:min-h-0 ue:grid-cols-1 ue:gap-3 ue:md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="ue:flex ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
            <div className="ue:border-b ue:border-line ue:p-2">
              <ui.Input
                size="sm"
                autoFocus
                value={q}
                placeholder={t('搜界面名')}
                onChange={(e: { target: { value: string } }) => setQ(e.target.value)}
              />
            </div>
            <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
              {!index.idx && (
                <li className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
                  {index.loading ? t('读取中…') : index.error || t('还没有资源索引：可以在上面直接写选择器')}
                </li>
              )}
              {list.rows.map((w) => (
                <li key={w.pkg}>
                  <button
                    type="button"
                    title={w.pkg}
                    onClick={() => choose(w)}
                    className={cn(
                      'ue:flex ue:w-full ue:items-center ue:gap-2 ue:px-3 ue:py-1.5 ue:text-left ue:text-footnote ue:hover:bg-sel',
                      wbp?.pkg === w.pkg && 'ue:bg-sel ue:text-fg',
                      !w.sure && 'ue:opacity-60',
                    )}
                  >
                    <WbpIcon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                    <span className="ue:min-w-0 ue:truncate ue:font-mono">{w.name}</span>
                    <span className="ue:ml-auto ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">{w.pkg}</span>
                  </button>
                </li>
              ))}
              {index.idx && list.total > list.rows.length && (
                <li className="ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle">
                  {t('还有 {n} 个，打字缩小范围', { n: list.total - list.rows.length })}
                </li>
              )}
              {index.idx && !list.rows.length && (
                <li className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">{t('没找到界面')}</li>
              )}
            </ul>
          </div>
          <div className="ue:flex ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
            {!hop ? (
              <p className="ue:p-3 ue:text-footnote ue:text-subtle">{t('先在左边选一个界面')}</p>
            ) : (
              <>
                <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1 ue:border-b ue:border-line ue:px-3 ue:py-2 ue:text-footnote">
                  {hops.map((x, i) => (
                    <span key={i} className="ue:flex ue:items-center ue:gap-1">
                      {i > 0 && <ChevronRight className="ue:h-3 ue:w-3 ue:text-subtle" />}
                      <button
                        type="button"
                        className={cn(
                          'ue:font-mono ue:hover:underline',
                          i === hops.length - 1 ? 'ue:text-fg' : 'ue:text-subtle',
                        )}
                        onClick={() => setHops(hops.slice(0, i + 1))}
                      >
                        {x.label}
                      </button>
                    </span>
                  ))}
                  {hops.length === 1 && wbp && (
                    <ui.Button
                      size="sm"
                      variant="ghost"
                      className="ue:ml-auto"
                      onClick={() => setSel(`${wbp.value}:.`)}
                    >
                      <LayoutTemplate className="ue:h-3.5 ue:w-3.5" />
                      {t('选整个界面')}
                    </ui.Button>
                  )}
                </div>
                {tree.nodes && tree.nodes.length > 12 && (
                  <div className="ue:border-b ue:border-line ue:p-2">
                    <ui.Input
                      size="sm"
                      value={filter}
                      placeholder={t('按名字、类名、文字筛')}
                      onChange={(e: { target: { value: string } }) => setFilter(e.target.value)}
                    />
                  </div>
                )}
                <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
                  {tree.loading && <li className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">{t('读取中…')}</li>}
                  {tree.error && <li className="ue:px-3 ue:py-2 ue:text-footnote ue:text-warning">{tree.error}</li>}
                  {shown.map((n) => {
                    const full = join(hop.prefix, n.selector)
                    return (
                      <li key={n.selector}>
                        <div
                          className={cn(
                            'ue:group ue:flex ue:items-center ue:gap-2 ue:pr-2 ue:hover:bg-sel',
                            sel.trim() === full && 'ue:bg-sel',
                          )}
                          style={{ paddingLeft: 12 + (filter ? 0 : n.depth * 14) }}
                        >
                          <button
                            type="button"
                            title={full}
                            onClick={() => setSel(full)}
                            onDoubleClick={() => onPick(full)}
                            className="ue:flex ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:py-1.5 ue:text-left ue:text-footnote"
                          >
                            <span
                              className={cn('ue:truncate ue:font-mono', n.isVariable ? 'ue:text-fg' : 'ue:text-muted')}
                            >
                              {n.name}
                            </span>
                            <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{n.class}</span>
                            {n.text && (
                              <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">
                                「{n.text}」
                              </span>
                            )}
                          </button>
                          {n.userWidget && (
                            <ui.Button
                              size="sm"
                              variant="ghost"
                              className="ue:shrink-0"
                              onClick={() => {
                                setFilter('')
                                setHops([...hops, { label: n.name, args: { class: n.class }, prefix: full }])
                              }}
                            >
                              <CornerDownRight className="ue:h-3.5 ue:w-3.5" />
                              {t('进去')}
                            </ui.Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
      {grabbing && (
        <PickDialog
          mode="target"
          onClose={() => setGrabbing(false)}
          onTarget={(tg) => {
            setSel(tg)
            setGrabbing(false)
          }}
        />
      )}
    </ui.Modal>
  )
}
