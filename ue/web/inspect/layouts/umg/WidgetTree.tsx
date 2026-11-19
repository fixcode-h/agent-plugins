import {
  AppWindow,
  Columns3,
  EyeOff,
  Image,
  Layers,
  LayoutTemplate,
  MousePointerClick,
  PanelsTopLeft,
  Rows3,
  Scan,
  ScrollText,
  Square,
  SquareCheck,
  Space,
  TextCursorInput,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { t } from '../../../host.ts'
import { TreeList, type TreeLine } from '../../../TreeList.tsx'
import { Hit, hitText, keepSet, TreeSearch } from '../../../tree-search.tsx'
import { Card } from '../../../ui.tsx'
import { countNodes } from './config.ts'
import { isHidden, type WNode } from './model.ts'

/** 按类挑图标（照 UE 控件面板的意思）；认不出的用窗口图标 */
const ICONS: [RegExp, LucideIcon][] = [
  [/^(TextBlock|RichTextBlock)$/, Type],
  [/Editable/, TextCursorInput],
  [/^Image$/, Image],
  [/^Border$/, Square],
  [/^Button$/, MousePointerClick],
  [/^CheckBox$/, SquareCheck],
  [/^VerticalBox$/, Rows3],
  [/^HorizontalBox$/, Columns3],
  [/^(Overlay|CanvasPanel)$/, Layers],
  [/^WidgetSwitcher$/, PanelsTopLeft],
  [/^Spacer$/, Space],
  [/^(SizeBox|ScaleBox)$/, Scan],
  [/^(ScrollBox|ListView|TileView)$/, ScrollText],
  [/^UserWidget$/, LayoutTemplate],
]
const iconOf = (n: WNode) => (n.user ? LayoutTemplate : (ICONS.find(([re]) => re.test(n.cls))?.[1] ?? AppWindow))

/**
 * 控件树（效果图 U1 左上）：名字 + 类名，变量标「变量」，WidgetSwitcher 的子页标序号和「当前页」，Collapsed / Hidden 的变淡带眼睛图标。
 * 搜索按名字或类名筛（命中的连同父级留着）；选中由外面管（和预览双向联动），从预览选中时滚到那一行、展开它的父级。
 */
export function WidgetTree({
  tree,
  selected,
  onSelect,
  reveal,
  source,
}: {
  tree?: WNode
  selected?: string
  onSelect: (key: string) => void
  /** 从预览选中时滚到这一行（seq 变了才滚） */
  reveal?: { key: string; seq: number }
  /** 数据来源的小字（UE / 配置） */
  source?: string
}) {
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  // 从预览选中：把它的父级都展开
  useEffect(() => {
    if (!reveal) return
    setClosed((s) => {
      const parts = reveal.key.split('/')
      const next = new Set(s)
      for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join('/'))
      return next.size === s.size ? s : next
    })
  }, [reveal])

  const lines = useMemo(() => {
    if (!tree) return []
    const { keep } = keepSet(
      [tree],
      (n) => n.children,
      (n) => n.key,
      (n) => hitText(q, n.name, n.cls),
    )
    const out: TreeLine[] = []
    const walk = (n: WNode, depth: number, parent?: WNode, index = 0) => {
      if (q.trim() && !keep.has(n.key)) return
      const open = !!q.trim() || !closed.has(n.key)
      const dim = isHidden(n)
      const page = parent?.cls === 'WidgetSwitcher'
      const current = page && (parent.active ?? 0) === index
      out.push({
        key: n.key,
        depth,
        icon: iconOf(n),
        iconTone: dim ? 'ue:text-subtle/60' : n.isVar ? 'ue:text-accent-text' : undefined,
        label: (
          <span className={dim ? 'ue:text-subtle' : undefined}>
            <Hit text={n.name} q={q} />
            <span className="ue:ml-1.5 ue:text-caption ue:text-subtle">
              {page ? `${index}${current ? ` · ${t('当前页')}` : ''}` : n.cls}
              {n.visibility && n.visibility !== 'Visible' && !page ? ` ${n.visibility}` : ''}
            </span>
          </span>
        ),
        title: [n.name, n.cls, n.visibility, n.asset].filter(Boolean).join('\n'),
        aside: dim ? (
          <EyeOff className="ue:h-3.5 ue:w-3.5" aria-label={t('不可见')} />
        ) : n.isVar ? (
          <span className="ue:rounded-[3px] ue:bg-warning/12 ue:px-1 ue:text-warning">{t('变量')}</span>
        ) : undefined,
        expandable: n.children.length > 0,
        open,
        selected: n.key === selected,
        onSelect: () => onSelect(n.key),
        onToggle: () =>
          setClosed((s) => {
            const next = new Set(s)
            if (next.has(n.key)) next.delete(n.key)
            else next.add(n.key)
            return next
          }),
      })
      if (open) n.children.forEach((c, i) => walk(c, depth + 1, n, i))
      if (n.truncated)
        out.push({
          key: `${n.key}/…`,
          depth: depth + 1,
          icon: AppWindow,
          label: <span className="ue:text-subtle">{t('子控件太多，没有全部列出')}</span>,
          expandable: false,
          open: false,
          selected: false,
        })
    }
    walk(tree, 0)
    return out
  }, [tree, q, closed, selected, onSelect])

  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={t('控件树')}
      aside={
        <span className="ue:truncate">
          {t('{n} 个控件', { n: countNodes(tree) })}
          {source ? ` · ${source}` : ''}
        </span>
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      <TreeSearch value={q} onChange={setQ} placeholder={t('搜控件名、类')} />
      {tree ? (
        <TreeList lines={lines} label={t('控件树')} reveal={reveal} />
      ) : (
        <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读不到控件树')}</p>
      )}
    </Card>
  )
}
