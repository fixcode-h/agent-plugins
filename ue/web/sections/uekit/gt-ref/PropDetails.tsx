import { useMemo } from 'react'
import type { GtPropItem } from '../../../../shared/gt-script/index.ts'
import { h } from '../../../host.ts'
import type { PropsData } from './live.ts'
import { itemsOf } from './pick/data.ts'
import { DetailPane } from './pick/DetailPane.tsx'

/**
 * 一个对象的细节面板（分析文档 G2、B6、B7）：录制时问标识、条件「对象的属性」的选属性都用选对象面板中栏这一份
 * （AssetForge 细节面板，属性按 UE 的 Category 分组，属性 · 方法 · Lua · 运行状态四页），取代原来自己画的属性树。
 * 行尾准星：标识时加进 / 拿出标识组，判断时选要判断的那一项
 */
export function PropDetails({
  data,
  loading,
  error,
  picked,
  onPick,
  className,
}: {
  data: PropsData | undefined
  loading?: boolean
  error?: string
  picked: string[]
  onPick: (it: GtPropItem) => void
  className?: string
}) {
  const { cn } = h()
  const items = useMemo(() => itemsOf(data?.groups), [data])
  const groupTitle = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of data?.groups ?? []) for (const it of g.items) m.set(it.prop, g.title)
    return (it: GtPropItem) => m.get(it.prop) ?? ''
  }, [data])
  return (
    <div className={cn('ue:flex ue:min-h-0 ue:flex-col', className)}>
      <DetailPane
        items={items}
        loading={loading}
        error={error}
        note={data?.unavailable}
        siblings={data?.siblings}
        groupTitle={groupTitle}
        picked={new Set(picked)}
        // 展开结构体后的子项没有 item：按路径造一项，kind 留空让比较按值推
        onPick={(prop, kind, value, it) => onPick(it ?? ({ prop, name: prop, kind, value, src: 'cpp' } as GtPropItem))}
      />
    </div>
  )
}
