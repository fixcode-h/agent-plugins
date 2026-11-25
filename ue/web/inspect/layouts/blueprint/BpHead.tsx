import { Info, PersonStanding, SlidersHorizontal, Workflow } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import { assetName, CommonActions } from '../common.tsx'
import type { BpOutline, BpView } from './model.ts'

const short = (p: string) => p.split(/[./]/).pop() ?? p

/**
 * 蓝图布局的页头（效果图 A1 顶上一行）：名字、Blueprint · 父类、UE 连没连上、路径；
 * 右边通用按钮（版本差异、导出到配置）和视图切换。不是 Actor 蓝图时没有「类默认值」
 */
export function BpHead({
  path,
  outline,
  online,
  fromFile,
  actor,
  view,
  onView,
}: {
  path: string
  outline?: BpOutline
  online: boolean
  fromFile?: string
  actor: boolean
  view: BpView
  onView: (v: BpView) => void
}) {
  const { ui } = h()
  const options = [
    { id: 'graph' as const, label: t('图表'), icon: Workflow },
    ...(actor ? [{ id: 'defaults' as const, label: t('类默认值'), icon: SlidersHorizontal }] : []),
    { id: 'info' as const, label: t('摘要与引用'), icon: Info },
  ]
  return (
    <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-2">
      <PersonStanding className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
      <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{assetName(path)}</span>
      <Badge title={outline?.parent}>{outline?.parent ? `Blueprint · ${short(outline.parent)}` : 'Blueprint'}</Badge>
      {fromFile ? (
        <Badge tone="warn" title={fromFile.trim()}>
          {t('从文件读 · 只读')}
        </Badge>
      ) : online ? (
        <Badge tone="ok">{t('UE 已连接')}</Badge>
      ) : (
        <Badge tone="warn">{t('UE 未连接')}</Badge>
      )}
      {outline?.dirty && <Badge tone="warn">{t('未保存')}</Badge>}
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
        {path.split('.')[0]}
      </span>
      <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
        <CommonActions path={path} />
        <ui.Segmented size="sm" label={t('视图')} value={view} onChange={onView} options={options} />
      </div>
    </header>
  )
}
