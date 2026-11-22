import { Copy, Crosshair, Ellipsis, Pencil, ScanSearch, Star, StarOff, Trash2, X } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { openMenuAt } from '../../../menu.tsx'
import type { RefHits } from '../../uekit/gt-ref/live.ts'
import { HitBadge, ObjRule, iconOf } from '../custom/ObjRule.tsx'

/**
 * 对象调用的对象头卡（GM 页梳理 L4，效果图 1）：选中对象的名字、匹配规则、此刻命中几个，和对这个对象的动作——
 * 改规则、读取…（中栏属性行出勾选，右栏读值）、加到常用、⋯（重命名、复制、删除）。取代以前右栏顶上的「调函数 / 取对象 / 改变量」
 */
export function ObjHead({
  obj,
  hit,
  live,
  reading,
  fav,
  onEdit,
  onRead,
  onFav,
  onRename,
  onCopy,
  onDelete,
}: {
  obj: GmObject
  hit?: RefHits
  live: boolean
  /** 正在「读取」：按钮变成「退出读取」 */
  reading: boolean
  fav: boolean
  onEdit: () => void
  onRead: (on: boolean) => void
  onFav: () => void
  onRename: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const { ui, cn } = h()
  const Icon = iconOf(obj)
  return (
    <header className="ue:flex ue:min-h-11 ue:shrink-0 ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:px-4 ue:py-1.5">
      <Icon className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-accent-text" />
      <span className="ue:truncate ue:text-body ue:font-semibold ue:text-fg">{obj.name}</span>
      <span className="ue:min-w-0 ue:max-w-[50%] ue:overflow-hidden">
        <ObjRule o={obj} small noIcon />
      </span>
      {obj.ref && live && <HitBadge n={hit?.count} error={hit?.error} />}
      <span className="ue:flex-1" />
      {obj.ref && (
        <ui.Button size="sm" variant="ghost" onClick={onEdit}>
          <Crosshair className="ue:h-3.5 ue:w-3.5" /> {t('改规则')}
        </ui.Button>
      )}
      {obj.ref && (
        <ui.Button
          size="sm"
          variant={reading ? 'secondary' : 'ghost'}
          title={t('在中间「属性」里勾要读的，读出每个命中实例此刻的值')}
          onClick={() => onRead(!reading)}
        >
          {reading ? <X className="ue:h-3.5 ue:w-3.5" /> : <ScanSearch className="ue:h-3.5 ue:w-3.5" />}
          {reading ? t('退出读取') : t('读取…')}
        </ui.Button>
      )}
      <ui.Button size="sm" variant="ghost" onClick={onFav}>
        {fav ? <StarOff className="ue:h-3.5 ue:w-3.5" /> : <Star className="ue:h-3.5 ue:w-3.5" />}
        {fav ? t('移出常用') : t('加到常用')}
      </ui.Button>
      <ui.IconButton
        icon={Ellipsis}
        size="sm"
        label={t('更多')}
        className={cn('ue:shrink-0')}
        onClick={(e: MouseEvent<HTMLElement>) =>
          openMenuAt(e.currentTarget, [
            { label: t('重命名'), icon: Pencil, onClick: onRename },
            { label: t('复制'), icon: Copy, onClick: onCopy },
            'sep',
            { label: t('删除'), icon: Trash2, danger: true, onClick: onDelete },
          ])
        }
      />
    </header>
  )
}
