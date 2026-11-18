import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { slotsOf, walk, type GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'

/** 主流程的步数：顶层几步、展开后一共几个叶子步骤（块本身不算，块里的一层层数进去；守护里的不算） */
export function mainCounts(doc: GtScript) {
  const top = Array.isArray(doc.steps) ? doc.steps.filter((s) => s && typeof s === 'object').length : 0
  let leaves = 0
  walk(doc, (e) => {
    if (e.inGuard || e.path[0] !== 'steps') return false
    if (!slotsOf(e.step).length) leaves++
  })
  return { top, leaves }
}

/** 能折叠的块的 key（id，没有 id 的按路径），和 listRows 的折叠集合同一种写法；守护 do 里的不在列表里，不算 */
export function foldableKeys(doc: GtScript) {
  const keys: string[] = []
  walk(doc, (e) => {
    if (e.inGuard) return false
    if (slotsOf(e.step).length) keys.push(typeof e.step.id === 'string' && e.step.id ? e.step.id : e.path.join('.'))
  })
  return keys
}

/**
 * 列表视图顶上的标题行（效果图 5）：「主流程 4 步 · 展开后 15 步」，右边全部折叠 / 展开。
 * 折叠状态归 ListView（键盘左右键也在改它），这里只给按钮
 */
export function ListHead({
  doc,
  anyFolded,
  onFoldAll,
}: {
  doc: GtScript
  anyFolded: boolean
  onFoldAll: (fold: boolean) => void
}) {
  const { ui } = h()
  const { top, leaves } = mainCounts(doc)
  const canFold = foldableKeys(doc).length > 0
  return (
    <div className="ue:flex ue:h-11 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:pr-2 ue:pl-4">
      <span className="ue:text-body ue:font-semibold ue:text-fg">{t('主流程')}</span>
      <span className="ue:text-footnote ue:text-subtle ue:tabular-nums">
        {leaves !== top ? t('{n} 步 · 展开后 {m} 步', { n: top, m: leaves }) : t('{n} 步', { n: top })}
      </span>
      {canFold && (
        <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={() => onFoldAll(!anyFolded)}>
          {anyFolded ? (
            <ChevronsUpDown className="ue:h-3.5 ue:w-3.5" />
          ) : (
            <ChevronsDownUp className="ue:h-3.5 ue:w-3.5" />
          )}
          {anyFolded ? t('全部展开') : t('全部折叠')}
        </ui.Button>
      )}
    </div>
  )
}
