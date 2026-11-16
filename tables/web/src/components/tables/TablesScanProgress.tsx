import { Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TablesListProgress } from '@shared/table-list'

/**
 * 表格目录扫描进度：找到了几个表格、看过几个目录、正在看哪个目录。
 * 第一次打开（列表还没有）放在列表位置，后台重扫时放在列表栏底部；还没收到进度时只说在读
 */
export function TablesScanProgress({
  progress,
  background,
}: {
  progress: TablesListProgress | null
  background?: boolean
}) {
  const p = progress
  const text = !p
    ? background
      ? t('正在后台检查表格目录的变化')
      : t('正在读取表格目录…')
    : t('正在扫描表格目录：已找到 {n} 个表格，看过 {d} 个目录', { n: p.found, d: p.dirs })
  return (
    <div
      role="status"
      className={
        background
          ? 'tb:flex tb:min-w-0 tb:flex-col tb:gap-0.5 tb:text-caption tb:text-subtle'
          : 'tb:flex tb:min-w-0 tb:flex-col tb:items-center tb:gap-1.5 tb:px-3 tb:py-6 tb:text-center tb:text-footnote tb:text-subtle'
      }
    >
      <span className="tb:flex tb:items-center tb:gap-1.5">
        <Loader2
          aria-hidden
          className={background ? 'tb:h-3 tb:w-3 tb:animate-spin' : 'tb:h-4 tb:w-4 tb:animate-spin'}
        />
        {text}
      </span>
      {p?.at && (
        <span title={p.at} className="tb:w-full tb:truncate tb:font-mono tb:text-caption">
          {p.at}
        </span>
      )}
    </div>
  )
}
