import {
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  SquarePen,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '../../menu.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { canExport, canImport, fileName, type useForgeActions } from './forge-actions.ts'
import { kindMeta } from './kinds.ts'
import { StatePill } from './StatePill.tsx'

type Actions = ReturnType<typeof useForgeActions>

/**
 * 右栏头部（设计稿 §2.2 第 1 条）：类型图标、配置文件名、状态，第二行「目录 · 类型 · rev」。
 * 右边只放一个跟状态走的主按钮，其余收进 ⋯：以前不管什么状态都并排「导出 / 导入」，
 * 用户得自己判断该点哪个（设计稿问题 6），被改过的应该先看差异再决定方向。
 */
export function ForgeHeader({
  entry,
  busy,
  actions,
  onDryRun,
}: {
  entry: ForgeEntry
  busy: boolean
  actions: Actions
  /** 演练导入：切到「导入计划」页签（那里调 forge.plan） */
  onDryRun: () => void
}) {
  const { ui, cn } = h()
  const k = kindMeta(entry.kind)
  const rel = (entry.config ?? '').replace(/\\/g, '/')
  const where = rel.split('/').slice(0, -1).join('/') || t('配置根')
  const off = busy || !!actions.busy
  const primary = primaryAction(entry, actions)
  const more = (e: MouseEvent) =>
    openMenu(e, [
      {
        label: entry.state === 'asset-changed' ? t('用配置覆盖资产') : t('导入'),
        icon: Download,
        disabled: off || !canImport(entry),
        onClick: () => void actions.importIt(),
      },
      {
        label: t('导出到配置'),
        icon: Upload,
        disabled: off || !canExport(entry),
        onClick: () => void actions.exportIt(),
      },
      { label: t('演练导入'), icon: FlaskConical, disabled: !canImport(entry), onClick: onDryRun },
      'sep',
      {
        label: t('在资源页打开'),
        icon: ExternalLink,
        disabled: !actions.openAsset || !canExport(entry),
        onClick: () => actions.openAsset?.(),
      },
      { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => void actions.reveal() },
      { label: t('用编辑器打开'), icon: SquarePen, onClick: () => void actions.openFile() },
      'sep',
      { label: t('复制配置路径'), icon: Copy, onClick: () => copyText(entry.configPath ?? rel) },
      {
        label: t('复制资产路径'),
        icon: Copy,
        disabled: !entry.asset,
        onClick: () => entry.asset && copyText(entry.asset),
      },
    ])
  return (
    <header className="ue:flex ue:min-h-14 ue:items-center ue:gap-3 ue:px-5 ue:py-2.5">
      <span className="ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg ue:bg-hover">
        <k.icon className={cn('ue:h-4 ue:w-4', k.tone)} strokeWidth={1.75} />
      </span>
      <span className="ue:flex ue:min-w-0 ue:flex-col">
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
          <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg" title={entry.configPath}>
            {fileName(entry)}
          </span>
          <StatePill state={entry.state} soft />
        </span>
        <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
          {where} · {k.label()}
          {entry.revision !== undefined && ` · rev ${entry.revision}`}
        </span>
      </span>
      <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1.5">
        {primary && (
          <ui.Button size="sm" disabled={off || primary.disabled} title={primary.title} onClick={primary.run}>
            <primary.icon className="ue:h-3.5 ue:w-3.5" /> {primary.label}
          </ui.Button>
        )}
        <ui.IconButton icon={Ellipsis} size="sm" label={t('更多操作')} onClick={more} />
      </div>
    </header>
  )
}

interface Primary {
  label: string
  title: string
  icon: LucideIcon
  run: () => void
  disabled?: boolean
}

/** 主按钮跟状态走（设计稿 §2.2 的表）：已同步没有主按钮 */
function primaryAction(entry: ForgeEntry, a: Actions): Primary | undefined {
  switch (entry.state) {
    case 'never-imported':
    case 'asset-missing':
      return {
        label: t('导入生成资源'),
        title: t('按配置生成资产并保存'),
        icon: Download,
        run: () => void a.importIt(),
      }
    case 'config-changed':
    case 'pending':
      return { label: t('导入'), title: t('按配置写资产并保存'), icon: Download, run: () => void a.importIt() }
    case 'asset-changed':
      return {
        label: t('导出到配置'),
        title: t('把资产现在的样子写回配置'),
        icon: Upload,
        run: () => void a.exportIt(),
        disabled: !canExport(entry),
      }
    case 'parse-error':
    case 'no-asset':
    case 'foreign':
      return {
        label: t('用编辑器打开'),
        title: t('用系统默认的编辑器打开这份配置'),
        icon: SquarePen,
        run: () => void a.openFile(),
      }
    default:
      return undefined
  }
}
