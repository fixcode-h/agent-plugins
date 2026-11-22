import { ChevronRight, Copy, Ellipsis, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { Fragment, type MouseEvent, type ReactNode } from 'react'
import { ConnPill } from '../../../conn/ConnPill.tsx'
import { HelpTip } from '../../../HelpTip.tsx'
import { h, t } from '../../../host.ts'
import { copyText, openMenuAt } from '../../../menu.tsx'

/**
 * GM 页的工具条（GM 页梳理 L1，用户 2026-11-22）：取代原来的大标题 + 长说明 + 对象调用自己的标题行。
 * 左边面包屑（GM › 分类 › 选中的），说明收进问号；右边连接状态（ConnPill，带开始 PIE / 启动编辑器）、刷新、⋯（扫描设置、数据存在哪）
 */
export function GmBar({
  crumbs,
  help,
  file,
  onRefresh,
  onLuaSetup,
}: {
  crumbs: ReactNode[]
  help: ReactNode
  /** gm.json 在哪（⋯ 里复制） */
  file?: string
  onRefresh: () => void
  onLuaSetup: () => void
}) {
  const { ui } = h()
  return (
    <header className="ue:flex ue:h-11 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4">
      <nav aria-label={t('位置')} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-body ue:text-muted">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />}
            <span className={i === crumbs.length - 1 ? 'ue:truncate ue:font-semibold ue:text-fg' : 'ue:shrink-0'}>
              {c}
            </span>
          </Fragment>
        ))}
        <HelpTip>{help}</HelpTip>
      </nav>
      <span className="ue:flex-1" />
      <ConnPill />
      <ui.Button size="sm" variant="ghost" onClick={onRefresh}>
        <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
      </ui.Button>
      <ui.IconButton
        icon={Ellipsis}
        size="sm"
        label={t('更多')}
        onClick={(e: MouseEvent<HTMLElement>) =>
          openMenuAt(e.currentTarget, [
            { label: t('Lua GM 扫描设置…'), icon: SlidersHorizontal, onClick: onLuaSetup },
            file && 'sep',
            file && { title: t('数据存在 {f}（团队共用）', { f: file }) },
            file && { label: t('复制 gm.json 的路径'), icon: Copy, onClick: () => copyText(file) },
          ])
        }
      />
    </header>
  )
}
