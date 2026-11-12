import { CaseSensitive, Regex, Replace, WholeWord, type LucideIcon } from 'lucide-react'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'
import type { SearchFlags } from './use-content-search'

/**
 * 跨表搜索框下面的一排开关：区分大小写、整格、正则（和表格里的查找替换同样三个），右边「全部替换」。
 * 开关做成和表格查找条「只查当前列」一样的小块：按下时强调色浅底，一眼看出哪几个开着
 */
export function TableSearchOptions({
  flags,
  onFlags,
  onReplace,
  canReplace,
}: {
  flags: SearchFlags
  onFlags: (f: SearchFlags) => void
  /** 不传就不显示「全部替换」（只读项目） */
  onReplace?: () => void
  canReplace: boolean
}) {
  const flag = (key: keyof SearchFlags, icon: LucideIcon, label: string, tip: string) => (
    <FlagChip
      icon={icon}
      label={label}
      tip={tip}
      on={!!flags[key]}
      onToggle={() => onFlags({ ...flags, [key]: !flags[key] })}
    />
  )
  return (
    <div role="group" aria-label={t('搜索选项')} className="tb:flex tb:items-center tb:gap-1">
      {flag('caseSensitive', CaseSensitive, t('区分大小写'), t('区分大小写'))}
      {flag(
        'whole',
        WholeWord,
        t('整格匹配'),
        t('整格匹配：格子和要找的完全一样；数组列（1001;1002）里某一项一样也算'),
      )}
      {flag('regex', Regex, t('正则'), t('按正则找，替换里可以用 $1 引用括号里的内容'))}
      {onReplace && (
        <button
          type="button"
          disabled={!canReplace}
          onClick={onReplace}
          title={t('把找到的全部替换：先预览每个文件改几格，勾选后再写')}
          className="chip-idle tb:ml-auto tb:inline-flex tb:h-6 tb:cursor-pointer tb:items-center tb:gap-1 tb:rounded-md tb:px-2 tb:text-caption tb:text-muted tb:hover:text-fg tb:disabled:cursor-not-allowed tb:disabled:opacity-40"
        >
          <Replace className="tb:h-3.5 tb:w-3.5" />
          {t('替换…')}
        </button>
      )}
    </div>
  )
}

/** 一个开关小块：图标 + 读屏名，按下时强调色浅底 */
export function FlagChip({
  icon: Icon,
  label,
  tip,
  on,
  onToggle,
}: {
  icon: LucideIcon
  label: string
  tip: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={tip}
      onClick={onToggle}
      className={cn(
        'tb:inline-flex tb:h-6 tb:w-7 tb:cursor-pointer tb:items-center tb:justify-center tb:rounded-md tb:transition-colors',
        on ? 'tb:bg-accent-soft tb:text-accent-text' : 'chip-idle tb:text-muted tb:hover:text-fg',
      )}
    >
      <Icon className="tb:h-3.5 tb:w-3.5" />
    </button>
  )
}
