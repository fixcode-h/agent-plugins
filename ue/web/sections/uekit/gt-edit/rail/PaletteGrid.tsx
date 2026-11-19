import type { EditResult, GtPath, GtScript } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { openMenuAt } from '../../../../menu.tsx'
import { blockUi, TONE_TEXT, type InsertItem } from '../../gt-blocks/index.ts'
import { GT_STEPS_MIME } from '../../gt-flow/dnd.ts'
import { insertPlace, insertStep } from '../insert-menu.ts'
import { cellItems, cellLook, cellMatches, paletteCells, TONE_SOFT, type PaletteCell } from './palette.ts'

/**
 * 节点格子（UE 页二级栏「节点」页签，编辑器用 portal 画进去）：两列小卡片。点一下插到选中步骤后面（一格多项时从格子下沿弹菜单选），
 * 拖到流程图的连线「+」或空槽上插在那里（拖的是这一格第一项）
 */
export function PaletteGrid({
  doc,
  selected,
  onChange,
  onSelect,
  q,
}: {
  doc: GtScript
  selected: GtPath[]
  onChange: (r: EditResult | GtScript | undefined, what?: string) => boolean
  onSelect: (paths: GtPath[]) => void
  q: string
}) {
  const { cn } = h()
  const list = paletteCells().filter((c) => cellMatches(c, q))
  if (!list.length) return <div className="ue:px-1 ue:py-1 ue:text-footnote ue:text-subtle">{t('没有对上的节点')}</div>

  const put = (it: InsertItem) => {
    const { slot, index } = insertPlace(doc, selected[0])
    onChange(insertStep(doc, slot, index, it.make()), t('插不进这里'))
  }

  const click = (c: PaletteCell, el: HTMLElement) => {
    if (c.run) return c.run({ doc, apply: (d: GtScript) => onChange(d), deselect: () => onSelect([]) })
    const items = cellItems(c)
    if (items.length === 1) return put(items[0])
    openMenuAt(
      el,
      items.map((it) => ({
        label: it.label(),
        icon: blockUi(it.action).icon,
        hint: `/${it.slash}`,
        onClick: () => put(it),
      })),
    )
  }

  return (
    <div className="ue:grid ue:grid-cols-2 ue:gap-1.5">
      {list.map((c) => {
        const { icon: Icon, tone } = cellLook(c)
        const first = c.run ? undefined : cellItems(c)[0]
        const empty = !c.run && !first
        return (
          <button
            key={c.id}
            type="button"
            disabled={empty}
            draggable={!!first}
            title={first?.hint?.()}
            onClick={(e) => click(c, e.currentTarget)}
            onDragStart={(e) => {
              if (!first) return e.preventDefault()
              e.dataTransfer.setData(GT_STEPS_MIME, JSON.stringify([first.make()]))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            className={cn(
              'ue:flex ue:h-9 ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-panel ue:px-2 ue:text-left ue:text-body ue:text-fg ue:transition-colors',
              empty ? 'ue:cursor-not-allowed ue:opacity-50' : 'ue:cursor-pointer ue:hover:bg-sel/60',
            )}
          >
            <span
              className={cn(
                'ue:flex ue:h-5 ue:w-5 ue:shrink-0 ue:items-center ue:justify-center ue:rounded',
                TONE_SOFT[tone],
              )}
            >
              <Icon className={cn('ue:h-3.5 ue:w-3.5', TONE_TEXT[tone])} />
            </span>
            <span className="ue:min-w-0 ue:truncate">{c.label()}</span>
          </button>
        )
      })}
    </div>
  )
}
