import { Box, LayoutTemplate, List, RefreshCw, Square, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  GtIdentItem,
  GtPropItem,
  GtRef,
  GtRefForResult,
  GtTarget,
  GtTreeNode,
} from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { PANE_FILL, PANE_FIXED, SplitHandle, usePane } from '../../../split.tsx'
import { TreeList, type TreeLine } from '../../../TreeList.tsx'
import { defaultIdent } from './compare-table.ts'
import { classShort, describeRef } from './describe.ts'
import { IdentList, IdentRow } from './IdentList.tsx'
import { highlight, refFor, useProps, useRefRpc, useTree } from './live.ts'
import { PropTree } from './PropTree.tsx'

/** 抓到的结果：引用（类 + 标识）、点到部件时的 target、判断模式下选的那一条判断 */
export interface TreePicked {
  ref: GtRef
  target?: GtTarget
  check?: GtIdentItem
}

const HOVER_MS = 80
/** gt.highlight 的租约是 60 秒：选中的那个隔一会儿再描一次，窗口开着就一直描着 */
const RENEW_MS = 20000

/**
 * 从游戏里抓（用户 2026-11-20：不用游戏画面，改成 Widget 树）：左边是此刻游戏页面上的 UMG 树（gt.tree，类似控件反射器，只列 UMG），
 * 悬停 / 选中时在游戏画面上描边（gt.highlight）；选中后右边列出命中链（gt.refFor，条目 → 界面…，选哪一层当对象），
 * 下面是这一层的属性树，点准星挑标识（判断模式下挑要判断的那个属性）。关窗口时清掉描边。
 * 存进脚本的只有类 + 标识（+ 部件），底下一直写着
 */
export function WidgetTreePick({
  project,
  mode,
  onClose,
  onUse,
  onSplit,
}: {
  project: string
  /** 判断模式下「按它分路」：把所在的如果换成按状态分支（落点 + 选中控件的类名） */
  onSplit?: (target: GtTarget, widgetClass?: string) => void
  /** ident：抓对象；target：抓动作落点（对象 + 部件）；judge：抓一条判断 */
  mode: 'ident' | 'target' | 'judge'
  onClose: () => void
  onUse: (r: TreePicked) => void
}) {
  const { ui, cn } = h()
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [onlyVisible, setOnlyVisible] = useState(true)
  const tree = useTree(project, true, { filter: q, onlyVisible })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string>()
  const [chain, setChain] = useState<GtRefForResult>()
  const [level, setLevel] = useState<number>()
  const [err, setErr] = useState('')
  const [ident, setIdent] = useState<GtIdentItem[]>([])
  const [check, setCheck] = useState<GtIdentItem>()
  const pane = usePane('gt-wtree', '40%', 260)
  const paneRef = useRef<HTMLDivElement>(null)
  const hoverT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const rpc = useRefRpc()

  // 打字停一会儿再按过滤词重读树
  useEffect(() => {
    const id = setTimeout(() => setQ(filter.trim()), 300)
    return () => clearTimeout(id)
  }, [filter])

  // 关窗口清描边；选中的隔一会儿续一次租约
  useEffect(() => () => void highlight(project, { clear: true }, rpc), [project, rpc])
  useEffect(() => {
    if (!sel) return
    const id = setInterval(() => void highlight(project, { node: sel }, rpc), RENEW_MS)
    return () => clearInterval(id)
  }, [project, sel, rpc])

  // 树读回来时默认展开前两层
  useEffect(() => {
    setOpen(new Set(tree.nodes.filter((n) => n.depth < 2).map((n) => n.id)))
  }, [tree.nodes])

  const pick = async (node: string, lv?: number) => {
    setSel(node)
    setErr('')
    void highlight(project, { node }, rpc)
    try {
      const r = await refFor(project, node, lv, rpc)
      setChain(r)
      setLevel(lv)
      setIdent(r.ref?.ident ?? [])
      setCheck(undefined)
    } catch (e) {
      setErr((e as Error).message)
      setChain(undefined)
    }
  }

  const lines = useMemo(() => flatten(tree.nodes, open), [tree.nodes, open])
  const treeLines: TreeLine[] = lines.map(({ n, kids }) => ({
    key: n.id,
    depth: n.depth,
    icon: n.user ? LayoutTemplate : n.container ? List : n.text !== undefined ? Type : Square,
    iconTone: n.user ? 'ue:text-accent' : undefined,
    label: (
      <span className={cn('ue:font-mono', n.visible === false && 'ue:opacity-55')}>
        {n.name || classShort(n.class)}
        {n.text && <span className="ue:ml-1.5 ue:font-sans ue:text-subtle">「{n.text}」</span>}
      </span>
    ),
    aside: n.container ? t('{n} 项', { n: n.container.count ?? 0 }) : classShort(n.class),
    title: `${n.class}${n.part ? ` · ${n.part}` : ''}`,
    expandable: kids,
    open: open.has(n.id),
    selected: sel === n.id,
    onToggle: () =>
      setOpen((s) => {
        const x = new Set(s)
        if (x.has(n.id)) x.delete(n.id)
        else x.add(n.id)
        return x
      }),
    onSelect: () => void pick(n.id),
    onHover: () => {
      clearTimeout(hoverT.current)
      hoverT.current = setTimeout(() => void highlight(project, { node: n.id }, rpc), HOVER_MS)
    },
  }))

  const layerNode = chain?.chain[level ?? chain.chain.findIndex((c) => c.class === chain.ref?.class)]?.node ?? sel
  const props = useProps(project, layerNode ? { node: layerNode } : undefined)
  const groups = props.data?.groups
  const ref: GtRef | undefined = chain?.ref ? { ...chain.ref, ident } : undefined
  const target = mode === 'target' && ref ? { ...chain?.target, obj: ref } : undefined

  const selNode = tree.nodes.find((n) => n.id === sel)

  const toggle = (it: GtPropItem) => {
    if (mode === 'judge') return setCheck(check?.prop === it.prop ? undefined : defaultIdent(it))
    setIdent(
      ident.some((x) => x.prop === it.prop) ? ident.filter((x) => x.prop !== it.prop) : [...ident, defaultIdent(it)],
    )
  }

  return (
    <ui.Modal
      open
      size="full"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('从游戏里抓')}
      footer={
        <>
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-subtle">
            {ref ? (
              <>
                <span className="ue:font-sans">{t('存进脚本的只有：')}</span>
                {describeRef(ref)}
                {target?.part ? ` › ${target.part}` : ''}
                {check ? ` · ${check.prop}` : ''}
              </>
            ) : (
              t('在左边树里选一个控件；悬停时游戏画面上会描边')
            )}
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          {onSplit && (
            <ui.Button
              variant="secondary"
              disabled={!ref}
              onClick={() => ref && onSplit({ ...chain?.target, obj: ref }, selNode?.class)}
            >
              {t('按它分路')}
            </ui.Button>
          )}
          <ui.Button
            disabled={!ref || (mode === 'judge' && !check)}
            onClick={() => ref && onUse({ ref, target, check })}
          >
            {t('用这个')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:min-h-[60vh] ue:flex-1 ue:flex-col ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line ue:lg:flex-row ue:lg:overflow-hidden">
        <section
          ref={paneRef}
          style={pane.style('70%')}
          className={cn(PANE_FIXED, 'ue:relative ue:flex ue:min-h-80 ue:flex-col ue:lg:min-h-0')}
          onMouseLeave={() => {
            clearTimeout(hoverT.current)
            void highlight(project, sel ? { node: sel } : { clear: true }, rpc)
          }}
        >
          <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-2 ue:py-1.5">
            <ui.Input
              size="sm"
              className="ue:min-w-0 ue:flex-1"
              placeholder={t('按类名、控件名找')}
              value={filter}
              onChange={(e: { target: { value: string } }) => setFilter(e.target.value)}
            />
            <label className="ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-footnote ue:text-fg">
              <input
                type="checkbox"
                className="ue:accent-accent"
                checked={onlyVisible}
                onChange={(e) => setOnlyVisible(e.target.checked)}
              />
              {t('只看显示着的')}
            </label>
            <ui.IconButton size="sm" label={t('重新读')} onClick={tree.refresh}>
              <RefreshCw className={cn('ue:h-3.5 ue:w-3.5', tree.loading && 'ue:animate-spin')} />
            </ui.IconButton>
          </div>
          {tree.error && <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-danger">{tree.error}</p>}
          {!tree.error && !tree.loading && !tree.nodes.length && (
            <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
              {t('此刻游戏里没有界面（或都被过滤掉了）')}
            </p>
          )}
          <TreeList lines={treeLines} label={t('游戏里的控件树')} />
          {tree.truncated && (
            <p className="ue:border-t ue:border-line ue:px-3 ue:py-1 ue:text-caption ue:text-subtle">
              {t('控件太多，只列了 {n} 个：按名字找', { n: tree.nodes.length })}
            </p>
          )}
          <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 360} />
        </section>
        <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col')}>
          {err && <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-danger">{err}</p>}
          {!chain && !err && (
            <p className="ue:px-3 ue:py-8 ue:text-center ue:text-footnote ue:text-subtle">
              {t('选中一个控件后，这里列出它在哪个界面里、能用哪些属性认出它')}
            </p>
          )}
          {chain && (
            <>
              <Chain chain={chain} level={level} onLevel={(lv) => sel && void pick(sel, lv)} />
              <PropTree
                className="ue:min-h-60 ue:flex-1 ue:border-t ue:border-line"
                data={props.data}
                loading={props.loading}
                error={props.error}
                mode={mode === 'judge' ? 'judge' : 'ident'}
                selected={mode === 'judge' ? (check ? [check.prop] : []) : ident.map((i) => i.prop)}
                onPick={toggle}
                loadPart={props.loadPart}
              />
              <div className="ue:max-h-[40%] ue:shrink-0 ue:overflow-auto ue:border-t ue:border-line ue:p-2">
                {mode === 'judge' ? (
                  check ? (
                    <IdentRow value={check} onChange={setCheck} groups={groups} />
                  ) : (
                    <p className="ue:text-footnote ue:text-subtle">{t('点属性旁的准星选要判断的那一项')}</p>
                  )
                ) : (
                  <>
                    {chain.ask && (
                      <p className="ue:mb-1.5 ue:text-footnote ue:text-warning">
                        {t('没有分数够的标识组合：挑几个能把它和同类区分开的属性')}
                      </p>
                    )}
                    <IdentList value={ident} onChange={setIdent} groups={groups} />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </ui.Modal>
  )
}

/** 命中链：从点到的往外（条目 → 界面…），选哪一层当对象 */
function Chain({ chain, level, onLevel }: { chain: GtRefForResult; level?: number; onLevel: (lv: number) => void }) {
  const { cn } = h()
  const cur = level ?? chain.chain.findIndex((c) => c.class === chain.ref?.class)
  const kindText = (k: string) =>
    ({ entry: t('列表条目'), widget: t('界面'), actor: 'Actor', component: t('组件') })[k] ?? k
  return (
    <div className="ue:flex ue:flex-col ue:gap-0.5 ue:px-2 ue:py-1.5">
      <span className="ue:px-1 ue:text-caption ue:text-subtle">
        {t('命中链 · 选哪一层当对象')}
        {chain.matches !== undefined && ` · ${t('按推荐标识此刻命中 {n} 个', { n: chain.matches })}`}
      </span>
      {chain.chain.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onLevel(i)}
          className={cn(
            'ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:text-left ue:text-footnote',
            i === cur ? 'ue:bg-sel' : 'ue:hover:bg-hover',
          )}
          style={{ paddingLeft: 8 + i * 12 }}
        >
          <Box className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          <span className="ue:shrink-0 ue:text-caption ue:text-muted">{kindText(c.kind)}</span>
          <span className="ue:truncate ue:font-mono ue:text-fg">{classShort(c.class)}</span>
          {c.part && <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">› {c.part}</span>}
          {c.note && <span className="ue:ml-auto ue:truncate ue:text-caption ue:text-subtle">{c.note}</span>}
        </button>
      ))}
    </div>
  )
}

/** 按展开状态把树摊成一列 */
function flatten(nodes: GtTreeNode[], open: Set<string>) {
  const kids = new Map<string, GtTreeNode[]>()
  const roots: GtTreeNode[] = []
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    if (n.parent && ids.has(n.parent)) {
      const list = kids.get(n.parent) ?? []
      list.push(n)
      kids.set(n.parent, list)
    } else roots.push(n)
  }
  const out: { n: GtTreeNode; kids: boolean }[] = []
  const walk = (list: GtTreeNode[]) => {
    for (const n of list) {
      const k = kids.get(n.id) ?? []
      out.push({ n, kids: k.length > 0 })
      if (open.has(n.id)) walk(k)
    }
  }
  walk(roots)
  return out
}
