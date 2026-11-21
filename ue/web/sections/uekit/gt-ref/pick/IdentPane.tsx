import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { GtIdentItem, GtPropItem } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { IdentList } from '../IdentList.tsx'
import type { RefHits } from '../live.ts'

/**
 * 第 4 栏「唯一标识组」：都要满足。卡片（路径小块 + 此刻值 + 删除）+ 按类型的比较，底下按名字找一个属性加进来。
 * 连着游戏时顶上写此刻命中几个：不是 1 个就提示再加一条（或换一条各不相同的）
 */
export function IdentPane({
  cls,
  ident,
  onChange,
  items,
  actual,
  live,
  me,
}: {
  cls: string
  ident: GtIdentItem[]
  onChange: (v: GtIdentItem[]) => void
  items: GtPropItem[]
  actual: (prop: string) => unknown
  live: boolean
  me?: RefHits
}) {
  const { cn } = h()
  return (
    <>
      <div className="ue:flex ue:flex-col ue:gap-0.5 ue:px-3 ue:pt-2 ue:pb-1">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('唯一标识组')}</span>
        <span className="ue:text-caption ue:text-subtle">{t('都要满足 · 点属性行尾的准星加')}</span>
      </div>
      {cls && live && me && (
        <p
          className={cn(
            'ue:flex ue:items-start ue:gap-1.5 ue:px-3 ue:py-1 ue:text-caption',
            me.count === 1 ? 'ue:text-success' : 'ue:text-warning',
          )}
        >
          {me.count === 1 ? (
            <CircleCheck className="ue:mt-px ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          ) : (
            <TriangleAlert className="ue:mt-px ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          )}
          {me.count === 1
            ? t('此刻正好命中 1 个')
            : me.count === 0
              ? t('此刻一个也没命中：标识写得太严，或这个对象此刻不在')
              : t('此刻命中 {n} 个：再加一条各不相同的标识', { n: me.count })}
        </p>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:px-3 ue:pb-3">
        {cls ? (
          <IdentList value={ident} onChange={onChange} items={items} actual={actual} />
        ) : (
          <span className="ue:text-footnote ue:text-subtle">{t('还没定类')}</span>
        )}
      </div>
    </>
  )
}
