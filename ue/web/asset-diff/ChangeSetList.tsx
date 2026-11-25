import { Folder } from 'lucide-react'
import { startTransition, useMemo, useState, type ReactNode } from 'react'
import { ResizeHandle, usePaneWidth } from '@panel/web/src/components/ui/resize'
import { TreeList, type TreeLine } from '@panel/web/src/components/ui/tree/tree-list'
import { Hit, TreeSearch, hitText } from '@panel/web/src/components/ui/tree/tree-search'
import { folderOf, groupAssets, nameOf, type ChangeAsset } from '../../shared/asset-diff/changeset.ts'
import { assetClassLabel, assetIcon } from '../asset-icons.ts'
import { h, t } from '../host.ts'
import { useKept } from '../keep.ts'

/** 类型分组的标题：中文名 + 类名（动画序列、蒙太奇的中文名一样，靠类名分开） */
export function typeName(cls: string) {
  const zh = assetClassLabel(cls)
  return zh === cls || !cls ? zh : `${zh} · ${cls}`
}

/**
 * 「同一次提交里一起改的资源」展开后的列表（用户 2026-11-25：491 个平铺成标签墙把差异挤没了）：
 * 搜索 + 按文件夹 / 按类型分组，行用共用的虚拟滚动树（只画看得见的几十行），整块限高、底边可拖，高度记在本机。
 * 点一行切到那个资源，停在同一版
 */
export function ChangeSetList({
  items,
  onOpen,
  side,
  head,
}: {
  items: ChangeAsset[]
  onOpen: (pkg: string) => void
  /** 挂在版本差异弹窗左栏的版本记录下面（用户 2026-11-25「点开放到左侧显示」）：顶边拖高，栏窄所以搜索和分组上下排 */
  side?: boolean
  /** 左栏里列表上面的标题行 */
  head?: ReactNode
}) {
  const { ui } = h()
  const pane = usePaneWidth(
    side ? 'ue-diff-same-commit-side' : 'ue-diff-same-commit',
    side ? 360 : 220,
    side ? 140 : 96,
    () => Math.round(window.innerHeight * (side ? 0.65 : 0.7)),
  )
  const [by, setBy] = useKept<'folder' | 'type'>('ue-diff-same-commit-by', 'folder')
  const [q, setQ] = useState('')
  const [shut, setShut] = useState<Record<string, boolean>>({})

  const found = useMemo(() => {
    const list = q.trim() ? items.filter((a) => hitText(q, nameOf(a.pkg), a.pkg, a.cls)) : items
    return { list, groups: groupAssets(list, by) }
  }, [items, q, by])

  const lines: TreeLine[] = []
  const searching = !!q.trim()
  // 只有一组时不画组标题，少一层
  const flat = found.groups.length === 1
  for (const g of found.groups) {
    const gk = `${by}:${g.key}`
    const open = searching || flat || !shut[gk]
    if (!flat) {
      const gi = by === 'type' ? assetIcon(g.key) : { icon: Folder, tone: 'ue:text-muted' }
      lines.push({
        key: gk,
        depth: 0,
        icon: gi.icon,
        iconTone: gi.tone,
        label: by === 'type' ? typeName(g.key) : g.key,
        title: by === 'type' ? typeName(g.key) : g.key,
        aside: <span className="ue:text-caption ue:text-subtle ue:tabular-nums">{g.items.length}</span>,
        expandable: true,
        open,
        selected: false,
        clickToggles: true,
        onToggle: () => setShut((s) => ({ ...s, [gk]: open })),
      })
    }
    if (!open) continue
    for (const a of g.items) {
      const ic = assetIcon(a.cls)
      lines.push({
        key: `${gk}/${a.pkg}`,
        depth: flat ? 0 : 1,
        icon: ic.icon,
        iconTone: ic.tone,
        label: (
          <span className="ue:font-mono">
            <Hit text={nameOf(a.pkg)} q={q} />
          </span>
        ),
        title: t('看 {p} 在这一版的差异', { p: a.pkg }),
        // 按文件夹分时行尾写类型，按类型分时写文件夹：分组里没说的那一项。左栏窄，不写，悬停看完整路径
        aside: side ? undefined : (
          <span className="ue:truncate ue:text-caption ue:text-subtle">
            {by === 'folder' ? (a.cls ? typeName(a.cls) : '') : folderOf(a.pkg)}
          </span>
        ),
        expandable: false,
        open: false,
        selected: false,
        onSelect: () => onOpen(a.pkg),
      })
    }
  }

  const search = (
    <TreeSearch
      value={q}
      onChange={(v) => startTransition(() => setQ(v))}
      placeholder={side ? t('搜名字、路径或类型') : t('搜这次提交里的资源：名字、路径或类型')}
      hits={found.list.length}
    />
  )
  const groupBy = (
    <ui.Segmented
      label={t('分组')}
      size="sm"
      value={by}
      onChange={(v: string) => setBy(v === 'type' ? 'type' : 'folder')}
      options={[
        { id: 'folder', label: t('按文件夹') },
        { id: 'type', label: t('按类型') },
      ]}
    />
  )
  const tree = <TreeList lines={lines} label={t('同一次提交里一起改的资源')} />

  if (side)
    return (
      <div
        className="ue:relative ue:flex ue:shrink-0 ue:flex-col ue:border-t ue:border-line"
        style={{ height: pane.width }}
      >
        <ResizeHandle pane={pane} side="top" label={t('拖动调整列表高度')} />
        {head}
        <div className="ue:[&>div]:border-b-0">{search}</div>
        <div className="ue:border-b ue:border-line ue:px-3 ue:pb-2">{groupBy}</div>
        {tree}
      </div>
    )

  return (
    // 拖动条放在裁剪框外面：裁剪框 overflow-hidden 会把伸出底边的那半截拖动条裁掉，鼠标按不准
    <div className="ue:relative ue:mt-1.5" style={{ height: pane.width }}>
      <div className="ue:flex ue:h-full ue:flex-col ue:overflow-hidden ue:rounded-(--c-card-radius) ue:border ue:border-line ue:bg-bg">
        <div className="ue:flex ue:items-start ue:border-b ue:border-line">
          <div className="ue:min-w-0 ue:flex-1 ue:[&>div]:border-b-0">{search}</div>
          <div className="ue:shrink-0 ue:px-3 ue:py-2">{groupBy}</div>
        </div>
        {tree}
      </div>
      <ResizeHandle pane={pane} side="bottom" label={t('拖动调整列表高度')} />
    </div>
  )
}
