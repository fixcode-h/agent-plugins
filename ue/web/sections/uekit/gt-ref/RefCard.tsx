import { Box, CircleCheck, CircleHelp, Crosshair, Ellipsis, TriangleAlert } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { GtMany, GtRef, GtRefLike } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { openMenu, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { classShort, describeRef, identShort, inText, isRefObj } from './describe.ts'
import type { RefHits } from './live.ts'

export const MANY_OPTIONS = () => [
  { id: 'error' as const, label: t('报错') },
  { id: 'first' as const, label: t('第一个') },
  { id: 'last' as const, label: t('最上层') },
  { id: 'nearest' as const, label: t('最近') },
]

/** 「命中几个」的小标：1 个绿，0 个 / 多个黄，没连游戏不显示 */
export function HitBadge({ hit, error }: { hit?: RefHits; error?: string }) {
  const { cn } = h()
  if (error) return <CircleHelp className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" aria-label={error} />
  if (!hit) return null
  const one = hit.count === 1
  return (
    <span
      title={hit.error}
      className={cn(
        'ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:text-caption',
        one ? 'ue:text-success' : 'ue:text-warning',
      )}
    >
      {one ? <CircleCheck className="ue:h-3.5 ue:w-3.5" /> : <TriangleAlert className="ue:h-3.5 ue:w-3.5" />}
      {hit.count === 0 ? t('没在屏上') : t('命中 {n} 个', { n: hit.count })}
    </span>
  )
}

/**
 * 对象卡（效果图 1「关哪个对象」）：名字、类、在哪找、唯一标识组 chips、命中几个；底下「命中多个时」和「改标识…」。
 * 命中几个由调用方用 useRefHit（gt.resolve 挂在 gt.watch 上收推送）算好传进来，这里只画。
 * 名字引用和 `$var` 只显示一行（对象本身在「脚本设置 → 对象」里改）
 */
export function RefCard({
  name,
  value,
  hit,
  hitError,
  onEdit,
  onMany,
  menu,
  compact,
}: {
  /** 命名对象的名字（脚本 objects 里的键） */
  name?: string
  value: GtRefLike | undefined
  hit?: RefHits
  hitError?: string
  onEdit?: () => void
  /** 改「命中多个时」；不给时只读显示 */
  onMany?: (m: GtMany) => void
  /** 右上「⋯」的菜单项 */
  menu?: MenuItem[]
  /** 只要一行（脚本设置的对象列表） */
  compact?: boolean
}) {
  const { ui, cn } = h()
  const ref: GtRef | undefined = isRefObj(value) ? value : undefined
  const ids = ref?.ident ?? []
  const head = (
    <div className="ue:flex ue:min-h-9 ue:min-w-0 ue:items-center ue:gap-1.5 ue:px-2.5">
      <Box className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      {name && <span className="ue:shrink-0 ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">{name}</span>}
      {name && <span className="ue:text-subtle">·</span>}
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={describeRef(value)}>
        {ref ? classShort(ref.class) : typeof value === 'string' ? value : t('（没选对象）')}
      </span>
      {ref && (
        <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1.5 ue:py-px ue:text-caption ue:text-muted">
          {inText(ref.in)}
        </span>
      )}
      {compact && ref && (
        <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">
          {ids.length ? ids.map(identShort).join(' · ') : t('只按类认')}
        </span>
      )}
      <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1">
        <HitBadge hit={hit} error={hitError} />
        {menu && (
          <ui.IconButton size="sm" label={t('更多')} onClick={(e: MouseEvent) => openMenu(e, menu)}>
            <Ellipsis className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        )}
      </span>
    </div>
  )
  if (compact)
    return (
      <div
        role={onEdit ? 'button' : undefined}
        tabIndex={onEdit ? 0 : undefined}
        onClick={onEdit}
        onKeyDown={(e) => e.key === 'Enter' && onEdit?.()}
        className={cn(
          'ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card',
          onEdit && 'ue:cursor-pointer ue:hover:bg-hover',
        )}
      >
        {head}
      </div>
    )
  return (
    <div className="ue:flex ue:flex-col ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card">
      {head}
      {ref && (
        <div className="ue:flex ue:flex-col ue:gap-1.5 ue:border-t ue:border-line/60 ue:px-2.5 ue:py-2">
          <span className="ue:text-caption ue:text-subtle">{t('唯一标识 · 每组都要满足')}</span>
          {ids.length ? (
            <div className="ue:flex ue:flex-wrap ue:gap-1">
              {ids.map((it, i) => (
                <span
                  key={i}
                  className="ue:rounded-sm ue:bg-accent/8 ue:px-1.5 ue:py-0.5 ue:font-mono ue:text-caption ue:text-fg"
                >
                  {identShort(it)}
                </span>
              ))}
            </div>
          ) : (
            <span className="ue:text-caption ue:text-subtle">{t('只按类认：同时开两份会报错')}</span>
          )}
        </div>
      )}
      {(ref || onEdit) && (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-t ue:border-line/60 ue:px-2.5 ue:py-1.5">
          {ref && (
            <>
              <span className="ue:text-caption ue:text-subtle">{t('命中多个时')}</span>
              <ui.Segmented
                size="sm"
                label={t('命中多个时')}
                value={ref.many ?? 'error'}
                onChange={(m: GtMany) => onMany?.(m)}
                options={MANY_OPTIONS().map((o) => ({ ...o, disabled: !onMany }))}
              />
            </>
          )}
          {onEdit && (
            <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={onEdit}>
              <Crosshair className="ue:h-3.5 ue:w-3.5" />
              {ref ? t('改标识…') : t('选对象…')}
            </ui.Button>
          )}
        </div>
      )}
    </div>
  )
}
