import { Check, Crosshair, FileCode, History, ListVideo, SquareTerminal, Wand2, X, type LucideIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { argsText } from '../../../shared/gm/common.ts'
import type { GmRun } from '../../../server/store.ts'
import { h, t } from '../../host.ts'
import type { GmEntry } from './data.ts'

export interface RecentRun {
  /** 找不到条目时没有（UE 没连上时的 C++ GM、改了名的 Lua GM、对象调用的记录）：照样列出来，灰显（B2） */
  entry?: GmEntry
  run: GmRun
}

const iconOf = (r: RecentRun): LucideIcon => {
  if (r.run.call) return Crosshair
  const src = r.entry?.src ?? r.run.key.slice(0, r.run.key.indexOf(':'))
  return src === 'lua'
    ? FileCode
    : src === 'custom'
      ? Crosshair
      : src === 'console'
        ? SquareTerminal
        : src === 'macro'
          ? ListVideo
          : Wand2
}

/**
 * GM 页右侧下方的「最近执行」（用户 2026-11-21：不放左边树里，放到右边下方）；对象调用页里换成「调用记录」（kind=objcall，用户 2026-11-22）。
 * 按时间倒序列一张表，点一行选中那条并把当时的参数填回去，右键能再执行、加到常用；高度在 GmPage 里可拖、记在本机。
 * 找不到条目的行（UE 没连上时的 C++ GM）不藏起来，灰显，悬停说为什么
 */
export function RecentRuns({
  items,
  selected,
  objcall,
  offlineWhy,
  onPick,
  onMenu,
}: {
  items: RecentRun[]
  /** 右边正在看的那条（条目键）：对应的行高亮 */
  selected?: string
  /** 对象调用的调用记录 */
  objcall?: boolean
  /** 找不到条目时的原因（UE 没在运行……） */
  offlineWhy?: string
  onPick: (r: RecentRun) => void
  /** 右键：再执行一次、填回参数、加到常用…… */
  onMenu?: (e: MouseEvent, r: RecentRun) => void
}) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:text-footnote ue:font-medium ue:text-fg">
        <History className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
        {objcall ? t('调用记录') : t('最近执行')}
        {items.length > 0 && <span className="ue:font-normal ue:text-subtle ue:tabular-nums">{items.length}</span>}
        {items.length > 0 && (
          <span className="ue:ml-auto ue:truncate ue:text-caption ue:font-normal ue:text-subtle">
            {objcall ? t('只记对象调用 · 点一行填回工作台') : t('点一行选中这条 GM 并填回参数')}
          </span>
        )}
      </header>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {!items.length && (
          <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
            {objcall ? t('还没有调过：调用、读取、改值都会记在这里') : t('还没有执行过 GM，执行后列在这里')}
          </p>
        )}
        {items.map((r, i) => {
          const Icon = iconOf(r)
          const gone = !r.entry && !r.run.call
          const accent = !!r.run.call || r.entry?.src === 'lua' || r.entry?.src === 'custom'
          return (
            <button
              key={`${r.run.at}|${i}`}
              type="button"
              onClick={() => onPick(r)}
              onContextMenu={onMenu ? (e) => onMenu(e, r) : undefined}
              title={[gone ? offlineWhy : '', r.run.code, r.run.out].filter(Boolean).join('\n')}
              className={cn(
                'ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:px-4 ue:text-left ue:text-footnote',
                selected && selected === r.run.key ? 'ue:bg-sel' : 'ue:hover:bg-hover',
                gone && 'ue:opacity-60',
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
                className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', accent ? 'ue:text-accent-text' : 'ue:text-subtle')}
              />
              {r.run.call && (
                <span className="ue:shrink-0 ue:rounded-(--c-badge-radius) ue:bg-hover ue:px-1.5 ue:text-caption ue:text-fg">
                  {r.run.call.obj}
                </span>
              )}
              <span className="ue:min-w-0 ue:shrink ue:truncate ue:font-mono ue:text-fg">
                {r.entry?.name ?? r.run.name}
                {!r.run.call && argsText(r.run.args) && <span className="ue:text-muted"> {argsText(r.run.args)}</span>}
              </span>
              <span
                className={cn(
                  'ue:min-w-0 ue:flex-1 ue:truncate ue:text-right',
                  r.run.ok ? 'ue:text-subtle' : 'ue:text-danger',
                )}
              >
                {r.run.out}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
