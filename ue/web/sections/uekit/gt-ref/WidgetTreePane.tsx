import { Box, Copy, LayoutTemplate, List, MousePointerClick, RefreshCw, Square, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GtRefForResult, GtTreeNode } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { Checkbox } from '../../../details/controls.tsx'
import { copyText, openMenu } from '../../../menu.tsx'
import { TreeList, type TreeLine } from '../../../TreeList.tsx'
import { classShort } from './describe.ts'
import { highlight, refFor, useRefRpc, useTree } from './live.ts'

const HOVER_MS = 80
/** gt.highlight 的租约是 60 秒：选中的那个隔一会儿再描一次，窗口开着就一直描着 */
const RENEW_MS = 20000

/** 在树里点了一个控件：命中链（gt.refFor）、点的节点、选的层（不给 = 推荐的那层） */
export interface TreeChain {
  chain: GtRefForResult
  node: string
  level?: number
  /** 当对象的那一层的节点（读属性用） */
  layerNode: string
}

/** 当对象的那层：选了层用选的，没选用推荐引用所在的那层 */
export const layerOf = (chain: GtRefForResult, level: number | undefined) =>
  level ?? chain.chain.findIndex((c) => c.class === chain.ref?.class)

/**
 * 此刻游戏页面上的 UMG 树（gt.tree，类似控件反射器，只列 UMG）和命中链：对象弹窗的左栏、「从游戏里抓」共用。
 * 悬停 / 选中时在游戏画面上描边（gt.highlight），关掉时清描边；选中后下面列出命中链（条目 → 界面…），选哪一层当对象。
 * 用户 2026-11-21：「从游戏里抓」和对象弹窗合成一个页面，树挪进对象弹窗左栏的「Widget 树」标签
 */
export function WidgetTreePane({
  project,
  onChain,
  onUseClass,
  showChain = true,
  className,
}: {
  /** 下面列不列命中链（选类那一步只要类，不列） */
  showChain?: boolean
  project: string
  onChain: (c: TreeChain) => void
  /** 双击一行、或右键「选这个类」：选好类进下一步（挑唯一标识） */
  onUseClass?: (n: GtTreeNode) => void
  className?: string
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
  const hoverT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const rpc = useRefRpc()

  // 打字停一会儿再按过滤词重读树
  useEffect(() => {
    const id = setTimeout(() => setQ(filter.trim()), 300)
    return () => clearTimeout(id)
  }, [filter])

  // 关掉清描边；选中的隔一会儿续一次租约
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
      onChain({ chain: r, node, level: lv, layerNode: r.chain[layerOf(r, lv)]?.node ?? node })
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
    // UMG 只能选 UserWidget 的子类（user）：TextBlock、Button 这类引擎控件不是单独的界面，靠所在界面 + 标识找
    onDouble: onUseClass && n.user ? () => onUseClass(n) : undefined,
    onMenu:
      onUseClass &&
      ((e) => {
        void pick(n.id)
        openMenu(e, [
          {
            label: t('选这个类 {c}', { c: classShort(n.class) }),
            icon: MousePointerClick,
            hint: n.user ? t('双击') : t('不是 UserWidget'),
            disabled: !n.user,
            onClick: () => onUseClass(n),
          },
          !n.user &&
            n.ownerClass && {
              label: t('选它所在界面的类 {c}', { c: classShort(n.ownerClass) }),
              icon: LayoutTemplate,
              onClick: () => {
                const owner = tree.nodes.find((x) => x.id === n.owner)
                if (owner) onUseClass(owner)
              },
            },
          'sep',
          { label: t('复制类名'), icon: Copy, onClick: () => copyText(n.class) },
        ])
      }),
    onHover: () => {
      clearTimeout(hoverT.current)
      hoverT.current = setTimeout(() => void highlight(project, { node: n.id }, rpc), HOVER_MS)
    },
  }))

  return (
    <div
      className={cn('ue:flex ue:min-h-0 ue:flex-col', className)}
      onMouseLeave={() => {
        clearTimeout(hoverT.current)
        void highlight(project, sel ? { node: sel } : { clear: true }, rpc)
      }}
    >
      <div className="ue:flex ue:items-center ue:gap-2 ue:px-2 ue:py-1.5">
        <ui.Input
          size="sm"
          className="ue:min-w-0 ue:flex-1"
          placeholder={t('按类名、控件名找')}
          value={filter}
          onChange={(e: { target: { value: string } }) => setFilter(e.target.value)}
        />
        <ui.IconButton size="sm" label={t('重新读')} onClick={tree.refresh}>
          <RefreshCw className={cn('ue:h-3.5 ue:w-3.5', tree.loading && 'ue:animate-spin')} />
        </ui.IconButton>
      </div>
      <div className="ue:flex ue:shrink-0 ue:items-center ue:gap-1.5 ue:px-2.5 ue:pb-1.5 ue:text-footnote ue:text-fg">
        <Checkbox checked={onlyVisible} label={t('只看显示着的')} onChange={setOnlyVisible} />
        <span className="ue:cursor-pointer" onClick={() => setOnlyVisible(!onlyVisible)}>
          {t('只看显示着的')}
        </span>
        <span className="ue:text-subtle">{t('· 悬停在游戏画面上描边')}</span>
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
      {err && <p className="ue:border-t ue:border-line ue:px-3 ue:py-2 ue:text-footnote ue:text-danger">{err}</p>}
      {chain && showChain && (
        <div className="ue:shrink-0 ue:border-t ue:border-line">
          <Chain chain={chain} level={level} onLevel={(lv) => sel && void pick(sel, lv)} />
        </div>
      )}
    </div>
  )
}

/** 命中链：从点到的往外（条目 → 界面…），选哪一层当对象 */
export function Chain({
  chain,
  level,
  onLevel,
}: {
  chain: GtRefForResult
  level?: number
  onLevel: (lv: number) => void
}) {
  const { cn } = h()
  const cur = layerOf(chain, level)
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
