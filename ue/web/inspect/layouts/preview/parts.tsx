import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import { Badge, Card } from '../../../ui.tsx'
import { assetName, CommonActions, InfoView } from '../common.tsx'
import type { LayoutProps } from '../types.ts'
import { shortName, type Stat } from './model.ts'

/** 预览类布局的中间视图：预览（各自的画面）或摘要与引用 */
export type PreviewViewId = 'preview' | 'info'

/**
 * 预览类布局（材质、贴图、网格、音频、Niagara）的页头：图标、名字、类、附加标签（父材质、骨骼……）、路径；
 * 右边通用按钮（版本差异、导出到配置）和「预览 / 摘要与引用」切换。和蓝图、UMG 的页头同一个样子
 */
export function AssetHead({
  path,
  icon: Icon,
  cls,
  badges,
  view,
  onView,
  previewLabel,
}: {
  path: string
  icon: LucideIcon
  cls?: string
  badges?: ReactNode
  view: PreviewViewId
  onView: (v: PreviewViewId) => void
  /** 「预览」按钮的名字（音频叫「信息」） */
  previewLabel?: string
}) {
  const { ui } = h()
  return (
    <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-2">
      <Icon className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
      <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{assetName(path)}</span>
      {cls && <Badge>{cls}</Badge>}
      {badges}
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
        {path.split('.')[0]}
      </span>
      <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
        <CommonActions path={path} />
        <ui.Segmented
          size="sm"
          label={t('视图')}
          value={view}
          onChange={onView}
          options={[
            { id: 'preview', label: previewLabel ?? t('预览') },
            { id: 'info', label: t('摘要与引用') },
          ]}
        />
      </div>
    </header>
  )
}

/** 页头下面一排统计（效果图 B5 顶上：三角形、顶点、LOD、材质槽……），来自资源注册表标签，不用加载资源 */
export function StatsStrip({ stats, aside }: { stats: Stat[]; aside?: ReactNode }) {
  if (!stats.length && !aside) return null
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-4 ue:gap-y-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-1.5 ue:text-footnote">
      {stats.map((s) => (
        <span key={s.key} className="ue:flex ue:items-baseline ue:gap-1.5" title={s.key}>
          <span className="ue:text-subtle">{s.label}</span>
          <span className="ue:font-mono ue:font-medium ue:text-fg">{s.value}</span>
        </span>
      ))}
      {aside && <span className="ue:ml-auto ue:text-caption ue:text-subtle">{aside}</span>}
    </div>
  )
}

/** 一行「名字 · 值」；值是资源路径时能点开（Ctrl+点在资源页打开交给外面） */
export interface InfoRow {
  key: string
  label: string
  value: string
  /** 值是能打开的资源路径 */
  ref?: string
}

/** 资源信息列表（骨骼网格左栏、音频中间、贴图细节上面）：两列，值用等宽字 */
export function InfoRows({ rows, onOpen }: { rows: InfoRow[]; onOpen?: (path: string) => void }) {
  return (
    <dl className="ue:grid ue:grid-cols-[minmax(6rem,40%)_1fr] ue:gap-x-3 ue:gap-y-1 ue:px-3 ue:py-2 ue:text-footnote">
      {rows.map((r) => (
        <div key={r.key} className="ue:contents">
          <dt className="ue:truncate ue:text-subtle" title={r.key}>
            {r.label}
          </dt>
          <dd className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg" title={r.ref ?? r.value}>
            {r.ref && onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(r.ref!)}
                className="ue:inline-flex ue:max-w-full ue:cursor-pointer ue:items-center ue:gap-1 ue:text-accent-text ue:hover:underline"
              >
                <span className="ue:truncate">{shortName(r.ref)}</span>
                <ArrowUpRight className="ue:h-3 ue:w-3 ue:shrink-0" />
              </button>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** 左栏可点的一行（材质节点、发射器、参数覆盖）：选中高亮，右边小字 */
export function PickRow({
  icon: Icon,
  label,
  aside,
  on,
  muted,
  depth = 0,
  title,
  onClick,
  lead,
}: {
  icon?: LucideIcon
  label: ReactNode
  aside?: ReactNode
  on?: boolean
  muted?: boolean
  depth?: number
  title?: string
  onClick?: () => void
  /** 图标前面的东西（颜色块、勾选框） */
  lead?: ReactNode
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={!onClick}
      onClick={onClick}
      style={{ paddingLeft: 12 + depth * 16 }}
      className={cn(
        'ue:flex ue:h-7 ue:w-full ue:items-center ue:gap-2 ue:pr-3 ue:text-left ue:text-footnote ue:transition-colors',
        onClick ? 'ue:cursor-pointer' : 'ue:cursor-default',
        on ? 'ue:bg-sel' : onClick && 'ue:hover:bg-hover',
        muted ? 'ue:text-subtle' : 'ue:text-fg',
      )}
    >
      {lead}
      {Icon && <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />}
      <span className="ue:min-w-0 ue:flex-1 ue:truncate">{label}</span>
      {aside !== undefined && aside !== '' && (
        <span className="ue:min-w-0 ue:shrink ue:truncate ue:text-caption ue:text-subtle">{aside}</span>
      )}
    </button>
  )
}

/** 左栏里一组的小标题（参数分组、节点类型） */
export function GroupTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="ue:flex ue:h-7 ue:items-center ue:gap-1.5 ue:px-3 ue:text-caption ue:font-medium ue:text-subtle">
      {children}
      {count !== undefined && <span className="ue:font-normal">{count}</span>}
    </div>
  )
}

/** 拿不到的东西写一句原因（不伪造）：灰字，放在列表最后 */
export function Why({ children }: { children: ReactNode }) {
  return <p className="ue:px-3 ue:py-2 ue:text-caption ue:leading-relaxed ue:text-subtle">{children}</p>
}

/** 中间切到「摘要与引用」时的整块（各布局一样） */
export function InfoCard({ path, onOpen }: Pick<LayoutProps, 'path' | 'onOpen'>) {
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={t('摘要与引用')}
      bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto"
    >
      <InfoView path={path} onOpen={onOpen} />
    </Card>
  )
}

/** 左栏的卡片外壳：标题 + 可滚动的列表 */
export function SideCard({
  title,
  icon: Icon,
  aside,
  children,
}: {
  title: ReactNode
  icon?: LucideIcon
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          {Icon && <Icon className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />}
          {title}
        </>
      }
      aside={aside}
      bodyClass="ue:min-h-0 ue:overflow-auto ue:py-1"
    >
      {children}
    </Card>
  )
}
