import { useState } from 'react'
import { ChevronRight, Undo2 } from 'lucide-react'
import type { DesignMessage } from '@shared/design'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'

type Changes = NonNullable<DesignMessage['changes']>

/** 改了什么的简称：属性名原样，位置写成「位置」 */
const keyName = (k: string) => (k === 'Slot' ? t('位置') : k === 'Class' ? t('引用的子控件') : k)

// 文案在渲染时取（切换界面语言后跟着变），颜色是固定的
const kindOf = (k: Changes['list'][number]['kind']) =>
  ({
    add: { label: t('新增'), tone: 'ud:text-success' },
    remove: { label: t('删除'), tone: 'ud:text-danger' },
    change: { label: t('修改'), tone: 'ud:text-accent-text' },
    rename: { label: t('改名'), tone: 'ud:text-peer' },
  })[k]

/**
 * AI 回复下面的「改了 N 处」：点开列出这一轮新增、删除、修改、改名的控件，点一条在画布上选中它；
 * 最后一条回复还有「撤销这一轮」，恢复这一轮开始前自动存的版本（恢复前又会存一个版本，撤销也能再撤回）
 */
export function ChangeList({
  changes,
  onPick,
  onUndo,
  disabled,
}: {
  changes: Changes
  onPick?: (tree: string, name: string) => void
  /** 只有最后一条、没在跑时给 */
  onUndo?: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rest = changes.total - changes.list.length
  return (
    <div className="ud:pl-[38px] ud:text-caption">
      <div className="ud:flex ud:flex-wrap ud:items-center ud:gap-x-3 ud:gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="ud:flex ud:cursor-pointer ud:items-center ud:gap-1 ud:text-subtle ud:hover:text-fg"
        >
          <ChevronRight className={cn('ud:h-3.5 ud:w-3.5 ud:transition-transform', open && 'ud:rotate-90')} />
          {t('改了 {n} 处', { n: changes.total })}
        </button>
        {onUndo && (
          <button
            type="button"
            disabled={disabled}
            onClick={onUndo}
            title={t('恢复到这一轮开始之前；恢复前会自动存一个版本，可以在「版本」里找回')}
            className="ud:flex ud:cursor-pointer ud:items-center ud:gap-1 ud:text-subtle ud:hover:text-fg ud:disabled:cursor-default ud:disabled:opacity-50"
          >
            <Undo2 className="ud:h-3.5 ud:w-3.5" />
            {t('撤销这一轮')}
          </button>
        )}
      </div>
      {open && (
        <ul className="ud:mt-1 ud:flex ud:flex-col ud:gap-0.5">
          {changes.list.map((c, i) => {
            const k = kindOf(c.kind)
            const pick = c.kind !== 'remove' && onPick ? () => onPick(c.tree, c.name) : undefined
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!pick}
                  onClick={pick}
                  title={pick ? t('在画布上选中它') : undefined}
                  className="ud:flex ud:w-full ud:min-w-0 ud:items-baseline ud:gap-2 ud:rounded-md ud:px-1.5 ud:py-0.5 ud:text-left ud:enabled:cursor-pointer ud:enabled:hover:bg-sel"
                >
                  <span className={cn('ud:shrink-0 ud:font-medium', k.tone)}>{k.label}</span>
                  <span className="ud:min-w-0 ud:truncate ud:font-mono ud:text-fg">
                    {c.tree && <span className="ud:text-subtle">{c.tree} / </span>}
                    {c.from ? `${c.from} → ${c.name}` : c.name}
                  </span>
                  {!!c.keys?.length && (
                    <span className="ud:min-w-0 ud:truncate ud:text-subtle">
                      {c.keys.slice(0, 4).map(keyName).join('、')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
          {rest > 0 && <li className="ud:px-1.5 ud:text-subtle">{t('还有 {n} 处', { n: rest })}</li>}
        </ul>
      )}
    </div>
  )
}
