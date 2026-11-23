import { AppWindow } from 'lucide-react'
import { useMemo } from 'react'
import type { GtClassItem, GtTreeNode } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { TreeList, type TreeLine } from '@panel/web/src/components/ui/tree/tree-list'
import { classShort } from '../describe.ts'
import { useTree } from '../live.ts'

/**
 * 类下拉的「屏幕上」页签（用户 2026-11-21）：按此刻屏上的控件树层级列界面，只列 UserWidget 的子类（gt.tree 的 user），
 * 中间的 Border、CanvasPanel 这类普通控件跳过，子界面直接挂在最近的上层界面下。点一行就选它的类
 */
export function ScreenTree({
  project,
  q,
  value,
  onPick,
}: {
  project: string
  q: string
  value: string
  onPick: (cls: string, item: GtClassItem) => void
}) {
  const tree = useTree(project, true, {})
  const lines = useMemo(() => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    // 最近的上层界面（跳过普通控件）
    const userParent = (n: GtTreeNode) => {
      const seen = new Set<string>()
      for (
        let p = n.parent ? byId.get(n.parent) : undefined;
        p && !seen.has(p.id);
        p = p.parent ? byId.get(p.parent) : undefined
      ) {
        seen.add(p.id)
        if (p.user) return p.id
      }
      return ''
    }
    const users = tree.nodes.filter((n) => n.user)
    const kids = new Map<string, GtTreeNode[]>()
    for (const n of users) {
      const p = userParent(n)
      kids.set(p, [...(kids.get(p) ?? []), n])
    }
    const needle = q.trim().toLowerCase()
    // 搜索时只留命中的和它们的上层界面
    const keep = new Set<string>()
    if (needle)
      for (const n of users) {
        if (!classShort(n.class).toLowerCase().includes(needle) && !(n.name ?? '').toLowerCase().includes(needle))
          continue
        for (let id: string = n.id; id; id = userParent(byId.get(id)!)) keep.add(id)
      }
    const out: TreeLine[] = []
    const walk = (parent: string, depth: number) => {
      for (const n of kids.get(parent) ?? []) {
        if (needle && !keep.has(n.id)) continue
        const cls = classShort(n.class)
        out.push({
          key: n.id,
          depth,
          icon: AppWindow,
          iconTone: 'ue:text-accent',
          label: <span className="ue:font-mono">{cls}</span>,
          aside: n.name && n.name !== cls ? n.name : '',
          title: n.class,
          expandable: false,
          open: true,
          selected: cls === value,
          onSelect: () => onPick(cls, { name: cls, kind: 'umg', kids: 0 }),
        })
        walk(n.id, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [tree.nodes, q, value, onPick])

  if (tree.error) return <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-warning">{tree.error}</p>
  if (!lines.length)
    return (
      <p className="ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
        {q ? t('屏上没有名字里含 {q} 的界面', { q }) : t('屏上此刻没有界面（要开着游戏）')}
      </p>
    )
  return <TreeList lines={lines} label={t('屏幕上')} />
}
