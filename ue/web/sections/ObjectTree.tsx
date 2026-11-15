import { Box } from 'lucide-react'
import { useMemo, useState } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { t } from '../host.ts'
import { useKept } from '../keep.ts'
import { TreeList, type TreeLine } from '../TreeList.tsx'
import { Hit, hitText, keepSet, TreeSearch } from '../tree-search.tsx'
import { ErrorText, Note } from '../ui.tsx'

interface Node {
  path: string
  name: string
  class: string
  more?: boolean
}
/** 没有收起项时用同一个空对象，免得每次渲染都让树重算 */
const NONE: Record<string, boolean> = {}

interface Kids {
  items: Node[]
  total?: number
  error?: string
}

/**
 * UObject 树（用户 2026-11-15：Actor 和 UObject 分开）：根是 GameInstance、世界、引擎，往下按外层（Outer）一层层列，
 * 不含 Actor、组件、关卡（这些在 Actor 页的大纲里）。展开一层才读一层，只有名字和类，点了哪个右边才读属性
 */
export function ObjectTree({
  tick,
  selected,
  onSelect,
}: {
  tick: number
  selected: string
  onSelect: (path: string) => void
}) {
  const { project, target } = useUe()
  const kk = `${project.id}/objects/tree`
  // 展开的节点和读到的下一层都留着（切页面回来不用重新展开）；换了目标世界就清掉
  const scope = `${target.instance ?? ''}/${target.world ?? ''}`
  const [open, setOpen] = useKept<Record<string, boolean>>(`${kk}/open/${scope}`, {})
  const [kids, setKids] = useKept<Record<string, Kids>>(`${kk}/kids/${scope}`, {})
  // 搜索词切页面回来还留着；搜索时为了露出命中项自动展开的节点，用户再点收起记在 fold（换关键词清掉）
  const [q, setQ] = useKept(`${kk}/q`, '')
  const [fold, setFold] = useState<{ q: string; m: Record<string, boolean> }>({ q: '', m: {} })
  const folded = fold.q === q ? fold.m : NONE
  const roots = useLoad(
    () => op<{ items: Node[] }>(project.id, 'objects.children', { world: target.world }, target),
    [project.id, target.instance, target.world, tick],
    0,
    `${kk}/roots/${scope}`,
  )
  const load = (path: string) =>
    op<{ items: Node[]; total?: number }>(project.id, 'objects.children', { path }, target).then(
      (r) => setKids((m) => ({ ...m, [path]: { items: r.items, total: r.total } })),
      (e: Error) => setKids((m) => ({ ...m, [path]: { items: [], error: e.message } })),
    )
  const toggle = (n: Node) => {
    const next = !open[n.path]
    setOpen((m) => ({ ...m, [n.path]: next }))
    // 每次展开都重读这一层：对象随时在建在销毁，展开时拿最新的
    if (next) void load(n.path)
  }

  const { lines, hits } = useMemo(() => {
    const items = roots.data?.items ?? []
    const kidsOf = (n: Node) => kids[n.path]?.items ?? []
    // 搜索时只筛已经读到的层：keep 是自己命中或下面有命中的节点
    const searching = !!q.trim()
    const { keep, hits } = searching
      ? keepSet(
          items,
          kidsOf,
          (n) => n.path,
          (n) => hitText(q, n.name, n.class),
        )
      : { keep: new Set<string>(), hits: 0 }
    const out: TreeLine[] = []
    // filter：这一层要不要按搜索筛；命中的节点用户自己展开时，下面照常全列
    const walk = (list: Node[], depth: number, filter: boolean) => {
      for (const n of list) {
        if (filter && !keep.has(n.path)) continue
        // 下面有命中的就自动展开（用户点了收起除外），否则照用户的展开状态
        const forced = filter && kidsOf(n).some((c) => keep.has(c.path))
        const isOpen = forced ? !folded[n.path] : !!open[n.path]
        out.push({
          key: n.path,
          depth,
          label: filter ? <Hit text={n.name} q={q} /> : n.name,
          icon: Box,
          expandable: !!n.more,
          open: isOpen,
          selected: selected === n.path,
          title: `${n.path} (${n.class})`,
          aside: filter ? <Hit text={n.class} q={q} /> : n.class,
          onToggle: forced ? () => setFold({ q, m: { ...folded, [n.path]: isOpen } }) : () => toggle(n),
          onSelect: () => onSelect(n.path),
        })
        if (!isOpen) continue
        if (forced) {
          walk(kidsOf(n), depth + 1, true)
          continue
        }
        const k = kids[n.path]
        if (!k) {
          out.push(note(`${n.path}#loading`, depth + 1, t('读取中…')))
          continue
        }
        if (k.error) out.push(note(`${n.path}#error`, depth + 1, k.error))
        walk(k.items, depth + 1, false)
        if (k.total && k.total > k.items.length)
          out.push(note(`${n.path}#more`, depth + 1, t('共 {n} 个，只列前 {m} 个', { n: k.total, m: k.items.length })))
      }
    }
    walk(items, 0, searching)
    return { lines: out, hits }
    // toggle、onSelect 每次渲染都是新的，按数据变化重算就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.data, open, kids, selected, q, folded])

  return (
    <>
      <TreeSearch value={q} onChange={setQ} placeholder={t('按名字或类名筛')} hits={hits} partial />
      <ErrorText>{roots.error}</ErrorText>
      {roots.error?.includes('不支持 objects.children') && (
        <Note>{t('UObject 树要 UELink 2.2.0 及以上，到「UE 插件」升级并在本地编译')}</Note>
      )}
      <TreeList lines={lines} label={t('UObject 树')} />
    </>
  )
}

/** 树里的提示行（读取中、出错、只列了前几个）：不能选也不能展开 */
function note(key: string, depth: number, text: string): TreeLine {
  return {
    key,
    depth,
    label: <span className="ue:text-subtle">{text}</span>,
    icon: Box,
    expandable: false,
    open: false,
    selected: false,
  }
}
