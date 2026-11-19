import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import { assetName, CommonActions } from '../common.tsx'

export interface HeadView<V extends string> {
  id: V
  label: string
  icon?: LucideIcon
}

/**
 * 资源页头（效果图 B1、B8、B9 顶上一行）：图标、名字、类徽标（类链里有用的父类也标出来）、路径；
 * 右边通用按钮（版本差异、导出到配置）和视图切换。数据表、数据资产、枚举、结构体、曲线共用，各布局只给图标和视图
 */
export function AssetHead<V extends string>({
  path,
  icon: Icon,
  badges,
  views,
  view,
  onView,
  extra,
}: {
  path: string
  icon: LucideIcon
  badges: ReactNode
  views: HeadView<V>[]
  view: V
  onView: (v: V) => void
  /** 视图切换前面多放的按钮（在 UE 里打开这类） */
  extra?: ReactNode
}) {
  const { ui } = h()
  return (
    <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-2">
      <Icon className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
      <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{assetName(path)}</span>
      {badges}
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
        {path.split('.')[0]}
      </span>
      <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
        {extra}
        <CommonActions path={path} />
        <ui.Segmented size="sm" label={t('视图')} value={view} onChange={onView} options={views} />
      </div>
    </header>
  )
}

/** 类徽标：资源的类，加上类链里第一个「认得出」的父类（ForgeConfigData · PrimaryDataAsset） */
export function ClassBadges({ cls, also }: { cls?: string; also?: string }) {
  return (
    <>
      {cls && <Badge>{cls}</Badge>}
      {also && also !== cls && <Badge>{also}</Badge>}
    </>
  )
}
