import { Box } from 'lucide-react'
import { useMemo } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { t } from '../host.ts'
import { useKept } from '../keep.ts'
import { TreeList, type TreeLine } from '../TreeList.tsx'
import { ErrorText, Note } from '../ui.tsx'

interface Node {
  path: string
  name: string
  class: string
  more?: boolean
}
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

  const lines = useMemo(() => {
    const out: TreeLine[] = []
    const walk = (list: Node[], depth: number) => {
      for (const n of list) {
        const isOpen = !!open[n.path]
        out.push({
          key: n.path,
          depth,
          label: n.name,
          icon: Box,
          expandable: !!n.more,
          open: isOpen,
          selected: selected === n.path,
          title: `${n.path} (${n.class})`,
          aside: n.class,
          onToggle: () => toggle(n),
          onSelect: () => onSelect(n.path),
        })
        if (!isOpen) continue
        const k = kids[n.path]
        if (!k) {
          out.push(note(`${n.path}#loading`, depth + 1, t('读取中…')))
          continue
        }
        if (k.error) out.push(note(`${n.path}#error`, depth + 1, k.error))
        walk(k.items, depth + 1)
        if (k.total && k.total > k.items.length)
          out.push(note(`${n.path}#more`, depth + 1, t('共 {n} 个，只列前 {m} 个', { n: k.total, m: k.items.length })))
      }
    }
    walk(roots.data?.items ?? [], 0)
    return out
    // toggle、onSelect 每次渲染都是新的，按数据变化重算就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.data, open, kids, selected])

  return (
    <>
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
