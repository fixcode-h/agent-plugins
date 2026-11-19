import { CornerDownRight, GitFork } from 'lucide-react'
import { t } from '../../../host.ts'
import { Badge, ErrorText } from '../../../ui.tsx'
import { shortName } from '../preview/model.ts'
import { GroupTitle, PickRow, SideCard, Why } from '../preview/parts.tsx'
import { KIND_ICON, Swatch } from './MaterialSide.tsx'
import type { Override, ParamKind } from './model.ts'
import type { ChainItem } from './use-material.ts'

const KIND_LABEL: Record<ParamKind, () => string> = {
  vector: () => t('颜色 / 向量'),
  scalar: () => t('标量'),
  texture: () => t('贴图'),
  switch: () => t('静态开关'),
  other: () => t('其他'),
}

/**
 * 材质实例的左栏（效果图 B3 右栏上半，这里放左边，右边留给细节）：父材质链（点一层跳过去）、覆盖了的参数。
 * 父材质里没被覆盖的参数要 UELink 给出参数表才能列，这里写明只列覆盖的
 */
export function InstanceSide({
  path,
  chain,
  chainError,
  overrides,
  error,
  onOpen,
}: {
  path: string
  chain?: ChainItem[]
  chainError: string
  overrides: Override[]
  error: string
  onOpen: (path: string) => void
}) {
  const kinds: ParamKind[] = ['vector', 'scalar', 'texture', 'switch']
  return (
    <SideCard title={t('父材质链')} icon={GitFork} aside={chain && t('{n} 层', { n: chain.length })}>
      {chainError && (
        <div className="ue:px-3 ue:py-1">
          <ErrorText>{chainError}</ErrorText>
        </div>
      )}
      {chain?.map((c, i) => (
        <PickRow
          key={c.path}
          depth={i}
          icon={i ? CornerDownRight : undefined}
          label={<span className="ue:font-mono">{shortName(c.path)}</span>}
          aside={c.path === path ? <Badge tone="accent">{t('当前')}</Badge> : c.class}
          title={c.path}
          onClick={c.path === path ? undefined : () => onOpen(c.path)}
        />
      ))}
      <div className="ue:mt-1 ue:border-t ue:border-line ue:pt-1">
        <GroupTitle count={overrides.length}>{t('覆盖的参数')}</GroupTitle>
        {error && (
          <div className="ue:px-3 ue:py-1">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        {kinds.map((k) => {
          const items = overrides.filter((o) => o.kind === k)
          if (!items.length) return null
          return (
            <section key={k}>
              <GroupTitle count={items.length}>{KIND_LABEL[k]()}</GroupTitle>
              {items.map((o) => (
                <PickRow
                  key={`${k}:${o.name}`}
                  icon={KIND_ICON[k]}
                  lead={<Swatch color={o.color} />}
                  label={o.name}
                  aside={o.value}
                  title={`${o.name} = ${o.value}`}
                  onClick={o.ref ? () => onOpen(o.ref!) : undefined}
                />
              ))}
            </section>
          )
        })}
        {!overrides.length && !error && <Why>{t('没有覆盖父材质的参数')}</Why>}
        <Why>
          {t(
            '只列这一层覆盖了的参数；没覆盖、沿用父材质的值在 UE 里看（UELink 还不给父材质的参数表）。改值在右边细节里。',
          )}
        </Why>
      </div>
    </SideCard>
  )
}
