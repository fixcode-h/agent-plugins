import { ExternalLink, FileCode2, FolderOpen, FolderX } from 'lucide-react'
import { h, t } from '../../host.ts'
import type { ForgeHealth } from './forge-source.ts'

/**
 * AssetForge 的空状态（设计稿 §2.4）：配置根不存在、配置根是空的时，不只一句话，
 * 说清楚配置从哪来、给出能点的下一步（打开配置根、去资源页导出）。
 * compact 用在左栏列表里，完整的用在主区。
 */
export type ForgeEmptyKind = 'no-root' | 'empty-root' | 'pick'

export function forgeEmptyKind(health: ForgeHealth | undefined, total: number): ForgeEmptyKind {
  if (health && !health.configRootExists) return 'no-root'
  return total ? 'pick' : 'empty-root'
}

export function ForgeEmpty({
  kind,
  root,
  compact,
  onReveal,
  onAssets,
}: {
  kind: ForgeEmptyKind
  root: string
  compact?: boolean
  onReveal: () => void
  onAssets: () => void
}) {
  const { ui, cn } = h()
  const Icon = kind === 'no-root' ? FolderX : FileCode2
  const title =
    kind === 'no-root'
      ? t('配置根还不存在')
      : kind === 'empty-root'
        ? t('配置根下还没有 JSON 配置')
        : t('选左边的一份配置')
  const body =
    kind === 'no-root'
      ? t(
          '配置根默认跟项目文档根走（项目外层有 ProjectDoc/docs 时是 ProjectDoc/docs/AssetForge，否则是项目里的 docs/AssetForge）。在资源页选中资产点「导出到 JSON」，会自动建出来。',
        )
      : kind === 'empty-root'
        ? t('在资源页选中资产点「导出到 JSON」，或右键资源目录批量导出；导出的配置会出现在这里。')
        : t('看它导入后生成的资源、属性差异、导入计划和配置原文。Ctrl 点选多份可以一起导入或导出。')
  return (
    <div
      className={cn(
        'ue:flex ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:text-center',
        compact ? 'ue:px-3 ue:py-6' : 'ue:flex-1 ue:p-8',
      )}
    >
      {!compact && <Icon className="ue:h-6 ue:w-6 ue:text-subtle" />}
      <p className={cn('ue:font-medium ue:text-fg', compact ? 'ue:text-footnote' : 'ue:text-body')}>{title}</p>
      {root && kind !== 'pick' && <code className="ue:font-mono ue:text-caption ue:text-muted">{root}</code>}
      <p className="ue:max-w-md ue:text-footnote ue:leading-relaxed ue:text-subtle">{body}</p>
      {kind !== 'pick' && (
        <div className="ue:mt-1 ue:flex ue:flex-wrap ue:justify-center ue:gap-2">
          {kind === 'empty-root' && (
            <ui.Button size="sm" variant="secondary" onClick={onReveal}>
              <FolderOpen className="ue:h-3.5 ue:w-3.5" />
              {t('打开配置根')}
            </ui.Button>
          )}
          <ui.Button size="sm" variant="secondary" onClick={onAssets}>
            <ExternalLink className="ue:h-3.5 ue:w-3.5" />
            {t('去资源页导出')}
          </ui.Button>
        </div>
      )}
    </div>
  )
}
