import { Check, Crosshair, FileCode, History, SquareTerminal, Wand2, X } from 'lucide-react'
import { argsText } from '../../../shared/gm/favs.ts'
import type { GmRun } from '../../../server/store.ts'
import { h, t } from '../../host.ts'
import type { GmEntry } from './data.ts'

export interface RecentRun {
  entry: GmEntry
  run: GmRun
}

/**
 * GM 页右侧下方的「最近执行」（用户 2026-11-21：不放左边树里，放到右边下方）。
 * 所有 GM 的执行按时间倒序列一张表，点一行选中那条 GM 并把当时的参数填回去；高度在 GmPage 里可拖、记在本机
 */
export function RecentRuns({
  items,
  selected,
  onPick,
}: {
  items: RecentRun[]
  /** 当前选中那一行（run:序号） */
  selected: string
  onPick: (line: string, r: RecentRun) => void
}) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:text-footnote ue:font-medium ue:text-fg">
        <History className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
        {t('最近执行')}
        {items.length > 0 && <span className="ue:font-normal ue:text-subtle ue:tabular-nums">{items.length}</span>}
        {items.length > 0 && (
          <span className="ue:ml-auto ue:font-normal ue:text-caption ue:text-subtle">
            {t('点一行选中这条 GM 并填回参数')}
          </span>
        )}
      </header>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {!items.length && (
          <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">{t('还没有执行过 GM，执行后列在这里')}</p>
        )}
        {items.map((r, i) => {
          const line = `run:${i}`
          const Icon =
            r.entry.src === 'lua'
              ? FileCode
              : r.entry.src === 'custom'
                ? Crosshair
                : r.entry.src === 'console'
                  ? SquareTerminal
                  : Wand2
          return (
            <button
              key={line}
              type="button"
              onClick={() => onPick(line, r)}
              title={[r.run.code, r.run.out].filter(Boolean).join('\n')}
              className={cn(
                'ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:px-4 ue:text-left ue:text-footnote',
                selected === line ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <span className="ue:w-16 ue:shrink-0 ue:text-caption ue:text-subtle ue:tabular-nums">
                {new Date(r.run.at).toLocaleTimeString()}
              </span>
              {r.run.ok ? (
                <Check className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
              ) : (
                <X className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
              )}
              <Icon
                className={cn(
                  'ue:h-3.5 ue:w-3.5 ue:shrink-0',
                  r.entry.src === 'lua' || r.entry.src === 'custom' ? 'ue:text-accent-text' : 'ue:text-subtle',
                )}
              />
              <span className="ue:min-w-0 ue:shrink ue:truncate ue:font-mono ue:text-fg">
                {r.entry.name}
                {argsText(r.run.args) && <span className="ue:text-muted"> {argsText(r.run.args)}</span>}
              </span>
              <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-right ue:text-subtle">{r.run.out}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
