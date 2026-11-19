import { Box, Hash, Image, Palette, SlidersHorizontal, ToggleLeft, type LucideIcon } from 'lucide-react'
import { t } from '../../../host.ts'
import { ErrorText } from '../../../ui.tsx'
import { GroupTitle, PickRow, SideCard, Why } from '../preview/parts.tsx'
import { groupParams, paramInfo, type MatNode, type ParamKind } from './model.ts'
import { useParamProps } from './use-material.ts'

export const KIND_ICON: Record<ParamKind, LucideIcon> = {
  scalar: Hash,
  vector: Palette,
  texture: Image,
  switch: ToggleLeft,
  other: SlidersHorizontal,
}

/** 颜色参数前面的小色块 */
export function Swatch({ color }: { color?: string }) {
  if (!color) return null
  return (
    <span
      aria-hidden
      className="ue:h-3 ue:w-3 ue:shrink-0 ue:rounded-sm ue:border ue:border-line"
      style={{ background: color }}
    />
  )
}

/**
 * 材质的左栏（效果图 B2 的「参数」和节点图的替代）：参数节点按分组列出（名字、默认值、颜色块），下面按类型列其余节点。
 * 点一个看它在右栏的细节。UELink 不导出材质图的连线和位置，所以不画节点图，写明原因
 */
export function MaterialSide({
  params,
  nodes,
  error,
  online,
  picked,
  onPick,
}: {
  params: MatNode[]
  nodes: MatNode[]
  error: string
  online: boolean
  picked: string
  onPick: (path: string) => void
}) {
  const props = useParamProps(params)
  const infos = params.map((n) => ({ n, ...paramInfo(n, props?.get(n.path)) }))
  return (
    <SideCard
      title={t('参数')}
      icon={SlidersHorizontal}
      aside={t('{n} 个参数 · {m} 个节点', { n: params.length, m: nodes.length })}
    >
      {error && (
        <div className="ue:px-3 ue:py-2">
          {online ? (
            <ErrorText>{error}</ErrorText>
          ) : (
            <Why>{t('UE 没连上：参数和节点要 UE 导出，打开编辑器后自动刷新')}</Why>
          )}
        </div>
      )}
      {!params.length && !error && <Why>{t('这个材质没有参数节点')}</Why>}
      {groupParams(infos).map(([group, items]) => (
        <section key={group || '_'}>
          <GroupTitle count={items.length}>{group || 'None'}</GroupTitle>
          {items.map((i) => (
            <PickRow
              key={i.n.path}
              icon={KIND_ICON[i.kind]}
              lead={<Swatch color={i.color} />}
              label={i.name}
              aside={i.value}
              title={`${i.name}\n${i.n.type}\n${i.value}`}
              on={picked === i.n.path}
              onClick={() => onPick(i.n.path)}
            />
          ))}
        </section>
      ))}
      {nodes.length > 0 && (
        <section className="ue:mt-1 ue:border-t ue:border-line ue:pt-1">
          <GroupTitle count={nodes.length}>{t('其余节点')}</GroupTitle>
          {nodes.map((x) => (
            <PickRow
              key={x.path}
              icon={Box}
              label={x.type}
              aside={x.name.replace(/^MaterialExpression/, '')}
              title={x.path}
              on={picked === x.path}
              onClick={() => onPick(x.path)}
            />
          ))}
        </section>
      )}
      <Why>{t('材质图的连线和节点位置 UELink 还导不出来：这里只列节点，点一个看它的属性；节点图在 UE 里看。')}</Why>
    </SideCard>
  )
}
