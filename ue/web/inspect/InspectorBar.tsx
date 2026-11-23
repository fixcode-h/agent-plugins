import { ArrowLeft, ArrowRight, ChevronRight, History, X } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { openMenuAt, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { Badge, KindBadge, type ObjKind } from '../ui.tsx'

/** 面包屑的一段：实例是蓝点、资源是橙点；via 是走到这一段用的属性（段前的虚线小框） */
export interface BarCrumb {
  key: string
  name: string
  /** 名字后面的小字（Actor 的组件、控件） */
  sub?: string
  title?: string
  asset: boolean
  via?: string
  /** 点前面的段 = 回到那一步；当前段没有 */
  onClick?: () => void
}

/** 「最近看过」的一条 */
export interface BarRecent {
  key: string
  name: string
  asset: boolean
  /** 怎么来的：「经 Static Mesh」「从大纲」 */
  how?: string
  current?: boolean
  /** 换了目标世界，这条运行时实例可能已经不在了：淡显 */
  stale?: boolean
  onClick: () => void
}

/**
 * 检视区导航条（设计稿第 5 节，图 1、2、3）：一行 44px，← → 最近看过 │ 引用链面包屑 │ 类型徽标 │ 动作。
 * 只管画，不碰历史和地址（Inspector.tsx 接上 useNavHistory），设置 →「组件」里能直接摆出来看
 */
export function InspectorBar({
  canBack,
  canForward,
  onBack,
  onForward,
  recent,
  onClear,
  crumbs,
  kind,
  actions,
  height = 44,
  crumbMax = 220,
}: {
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  recent: BarRecent[]
  onClear: () => void
  crumbs: BarCrumb[]
  kind?: ObjKind
  actions?: ReactNode
  /** 行高（设置里调） */
  height?: number
  /** 面包屑前面几段的最大宽度，放不下时先截它们；当前段不截 */
  crumbMax?: number
}) {
  const { ui, cn } = h()
  const openRecent = (el: HTMLElement) =>
    openMenuAt(el, [
      { title: t('最近看过 · 点一项直接回去') },
      ...recent.map((r): MenuItem => ({
        label: r.name,
        hint: r.how,
        checked: r.current,
        dim: r.stale,
        lead: <Badge tone={r.asset ? 'warn' : 'run'}>{r.asset ? t('资源') : t('实例')}</Badge>,
        onClick: r.onClick,
      })),
      'sep',
      { label: t('清空记录'), icon: X, hint: t('只留在这个页面，刷新整页就清'), onClick: onClear },
    ])
  return (
    <div
      style={{ height }}
      className="ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:border-b ue:border-line ue:bg-card ue:px-2"
    >
      <ui.IconButton icon={ArrowLeft} label={t('后退（Alt+←）')} size="sm" disabled={!canBack} onClick={onBack} />
      <ui.IconButton
        icon={ArrowRight}
        label={t('前进（Alt+→）')}
        size="sm"
        disabled={!canForward}
        onClick={onForward}
      />
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={t('最近看过')}
        title={t('最近看过')}
        disabled={!recent.length}
        onClick={(e) => openRecent(e.currentTarget)}
        className="ue:flex ue:h-7 ue:w-7 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-md ue:text-muted ue:hover:bg-hover ue:hover:text-fg ue:disabled:cursor-default ue:disabled:opacity-40"
      >
        <History className="ue:h-4 ue:w-4" />
      </button>
      <span className="ue:mx-1 ue:h-5 ue:w-px ue:shrink-0 ue:bg-line" />
      <nav
        aria-label={t('引用链')}
        className="ue:flex ue:min-w-0 ue:flex-1 ue:items-center ue:gap-1 ue:overflow-hidden"
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={c.key}>
              {i > 0 && <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />}
              {c.via && (
                <span
                  title={t('经 {p}', { p: c.via })}
                  className="ue:max-w-28 ue:min-w-0 ue:shrink ue:truncate ue:rounded-sm ue:border ue:border-dashed ue:border-line-strong ue:px-1.5 ue:font-mono ue:text-caption ue:text-subtle"
                >
                  {c.via}
                </span>
              )}
              <button
                type="button"
                title={c.title}
                disabled={!c.onClick}
                onClick={c.onClick}
                style={last ? undefined : { maxWidth: crumbMax }}
                className={cn(
                  'ue:flex ue:h-7 ue:items-center ue:gap-1.5 ue:rounded-md ue:px-1.5 ue:font-mono ue:text-footnote',
                  // 前面的段先截断（shrink），当前段不截（shrink-0）
                  last ? 'ue:max-w-full ue:shrink-0 ue:bg-hover ue:text-fg' : 'ue:min-w-0 ue:shrink ue:text-muted',
                  c.onClick && 'ue:cursor-pointer ue:hover:bg-hover ue:hover:text-fg',
                )}
              >
                <span
                  className={cn(
                    'ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full',
                    c.asset ? 'ue:bg-warning' : 'ue:bg-run',
                  )}
                />
                <span className={cn('ue:truncate', last && 'ue:font-medium')}>{c.name}</span>
                {c.sub && <span className="ue:truncate ue:text-caption ue:text-subtle">· {c.sub}</span>}
              </button>
            </Fragment>
          )
        })}
      </nav>
      <KindBadge kind={kind} />
      {actions && <div className="ue:flex ue:shrink-0 ue:items-center ue:gap-0.5 ue:pl-1">{actions}</div>}
    </div>
  )
}
