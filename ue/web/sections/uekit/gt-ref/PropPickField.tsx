import type { GtPropItem } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { PathChips } from '../../../path-chips/PathChips.tsx'
import { stateName } from './IdentList.tsx'
import { PropFind } from './PropFind.tsx'

/**
 * 选一个属性（判断项、步骤里的属性字段）：上面用小块显示当前选的（界面不出现路径符号，用户 2026-11-21），
 * 下面按名字找一个换掉；属性树里没有的（游戏没开、在更深的结构里）也能按写法填
 */
export function PropPickField({
  value,
  onChange,
  items,
  className,
}: {
  value: string
  onChange: (prop: string, item?: GtPropItem) => void
  items: GtPropItem[]
  className?: string
}) {
  const { cn } = h()
  return (
    <div className={cn('ue:flex ue:min-w-0 ue:flex-col ue:gap-1', className)}>
      <div className="ue:flex ue:min-h-7 ue:min-w-0 ue:items-center ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-field ue:px-2 ue:py-1">
        {value ? (
          <PathChips path={value} small stateName={stateName} />
        ) : (
          <span className="ue:text-footnote ue:text-subtle">{t('还没选属性')}</span>
        )}
      </div>
      <PropFind items={items} onAdd={onChange} placeholder={value ? t('按名字换一个属性') : undefined} />
    </div>
  )
}
