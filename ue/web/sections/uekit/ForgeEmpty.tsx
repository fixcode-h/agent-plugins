import { ExternalLink, FileCode2, FilePlus2, FolderOpen, FolderX, Sparkles } from 'lucide-react'
import { h, t } from '../../host.ts'
import { PathText } from '../../path-text.tsx'
import type { ForgeHealth } from './forge-source.ts'
import type { ForgeNewMode } from './ForgeNew.tsx'

/**
 * AssetForge 的空状态（设计稿 §2.4）：配置根不存在、配置根是空的时，不只一句话，
 * 说清楚配置从哪来、给出能点的下一步（打开配置根、去资源页导出）。
 * compact 用在左栏列表里，完整的用在主区。
 * 用户 2026-11-16：配置根打开页面时自动建（forge-source.ts），「配置根还不存在」只在自动建失败时出现；
 * 空的配置根给「从模板新建」「让 AI 写」两个入口。路径用 PathText，长了省略前面、不撑出横向滚动条。
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
  onNew,
  canAi,
  createError,
}: {
  kind: ForgeEmptyKind
  root: string
  compact?: boolean
  onReveal: () => void
  onAssets: () => void
  onNew: (mode: ForgeNewMode) => void
  canAi: boolean
  /** 配置根自动建失败的原因 */
  createError?: string
}) {
  const { ui, cn } = h()
  const Icon = kind === 'no-root' ? FolderX : FileCode2
  const title =
    kind === 'no-root'
      ? t('配置根建不出来')
      : kind === 'empty-root'
        ? t('配置根下还没有 JSON 配置')
        : t('选左边的一份配置')
  const body =
    kind === 'no-root'
      ? t(
          '配置根默认是项目文档根下的 AssetForge（和面板「文档」角色同一个文档根，P4 项目是各分支共用的 ProjectDoc/docs），在 UE 的项目设置 → 插件 → Asset Forge 里可以改。面板只能在项目、ProjectDoc 和项目文档根里建目录；在资源页导出到 JSON 时 UE 也会建出来。',
        )
      : kind === 'empty-root'
        ? t('从模板新建一份，让 AI 按需求写一份，或者在资源页把已有资产「导出到 JSON」纳管。')
        : t('看它导入后生成的资源、属性差异、导入计划和配置原文。Ctrl 点选多份可以一起导入或导出。')
  return (
    <div
      className={cn(
        'ue:flex ue:min-w-0 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:text-center',
        compact ? 'ue:px-3 ue:py-6' : 'ue:flex-1 ue:p-8',
      )}
    >
      {!compact && <Icon className="ue:h-6 ue:w-6 ue:text-subtle" />}
      <p className={cn('ue:font-medium ue:text-fg', compact ? 'ue:text-footnote' : 'ue:text-body')}>{title}</p>
      {/* 左栏里的是缩略版：配置根在左栏底部已经有了，说明文字留给主区，只留标题和按钮 */}
      {root && kind !== 'pick' && !compact && (
        <PathText path={root} tail={3} className="ue:text-caption ue:text-muted" />
      )}
      {kind === 'no-root' && createError && (
        <p className="ue:max-w-md ue:text-footnote ue:break-all ue:text-danger">{createError}</p>
      )}
      {(!compact || kind === 'no-root') && (
        <p className="ue:max-w-md ue:text-footnote ue:leading-relaxed ue:text-subtle">{body}</p>
      )}
      {kind !== 'pick' && (
        <div className="ue:mt-1 ue:flex ue:flex-wrap ue:justify-center ue:gap-2">
          {kind === 'empty-root' && (
            <>
              <ui.Button size="sm" onClick={() => onNew('template')}>
                <FilePlus2 className="ue:h-3.5 ue:w-3.5" />
                {t('从模板新建')}
              </ui.Button>
              {canAi && (
                <ui.Button size="sm" variant="secondary" onClick={() => onNew('ai')}>
                  <Sparkles className="ue:h-3.5 ue:w-3.5" />
                  {t('让 AI 写')}
                </ui.Button>
              )}
              {!compact && (
                <ui.Button size="sm" variant="secondary" onClick={onReveal}>
                  <FolderOpen className="ue:h-3.5 ue:w-3.5" />
                  {t('打开配置根')}
                </ui.Button>
              )}
            </>
          )}
          {(!compact || kind === 'no-root') && (
            <ui.Button size="sm" variant="secondary" onClick={onAssets}>
              <ExternalLink className="ue:h-3.5 ue:w-3.5" />
              {t('去资源页导出')}
            </ui.Button>
          )}
        </div>
      )}
    </div>
  )
}
