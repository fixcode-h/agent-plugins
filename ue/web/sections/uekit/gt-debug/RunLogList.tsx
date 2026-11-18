import { PauseCircle, Repeat, ShieldCheck } from 'lucide-react'
import type { GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { ms, StepIcon } from '../GtStepDetail.tsx'
import { guardTitle, titleOfKey } from './lookup.ts'
import { clock, type LogEntry } from './run-log.ts'

const RESULT: Record<string, string> = { passed: 'succeeded', failed: 'failed', already: 'already', skipped: 'skipped' }

/**
 * 「运行记录」页（效果图 6）：按到达顺序一行一条，块里的缩进；守护触发的一条整行染底，它处理时做的步骤缩在下面。
 * 点一行在画布 / 列表里选中那一步。最新的在最下面，跑着时自动滚到底
 */
export function RunLogList({
  doc,
  entries,
  onSelect,
}: {
  doc?: GtScript
  entries: LogEntry[]
  onSelect: (p: GtPath) => void
}) {
  const { cn } = h()
  if (!entries.length)
    return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('还没有记录：点「运行」后每进出一个节点记一条')}</p>
  return (
    <ol
      className="ue:flex ue:flex-col ue:py-1"
      ref={(el) => {
        // 新记录来了滚到底：人往上翻着看时（离底超过一屏）不打扰
        if (
          el?.parentElement &&
          el.parentElement.scrollHeight - el.parentElement.scrollTop < el.parentElement.clientHeight * 2
        )
          el.parentElement.scrollTop = el.parentElement.scrollHeight
      }}
    >
      {entries.map((e) => {
        const info = e.kind === 'guard' ? undefined : titleOfKey(doc, e.key)
        const title =
          e.kind === 'guard'
            ? t('守护「{g}」触发', { g: guardTitle(doc, e.key) })
            : e.kind === 'iter'
              ? t('{s} · 第 {n} 轮', { s: info!.title, n: (e.iter ?? 0) + 1 })
              : e.kind === 'pause'
                ? t('停在 {s}', { s: info!.title })
                : info!.title
        const icon =
          e.kind === 'guard' ? (
            <ShieldCheck
              className={cn('ue:h-3.5 ue:w-3.5', e.status === 'failed' ? 'ue:text-danger' : 'ue:text-success')}
            />
          ) : e.kind === 'iter' ? (
            <Repeat className="ue:h-3.5 ue:w-3.5 ue:text-run" />
          ) : e.kind === 'pause' ? (
            <PauseCircle className="ue:h-3.5 ue:w-3.5 ue:text-warning" />
          ) : (
            <StepIcon s={RESULT[e.status ?? '']} live={e.status === 'running'} />
          )
        return (
          <li key={e.n}>
            <button
              type="button"
              disabled={!info?.path}
              onClick={() => info?.path && onSelect(info.path)}
              style={{ paddingLeft: 16 + Math.min(e.depth, 6) * 14 }}
              className={cn(
                'ue:flex ue:w-full ue:items-start ue:gap-2 ue:py-1.5 ue:pr-4 ue:text-left',
                info?.path && 'ue:cursor-pointer ue:hover:bg-hover',
                e.kind === 'guard' && 'ue:bg-success/8',
                e.kind === 'pause' && 'ue:bg-warning/8',
              )}
            >
              <span className="ue:mt-0.5 ue:shrink-0">{icon}</span>
              <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
                <span className="ue:truncate ue:text-footnote ue:text-fg">{title}</span>
                {info?.sub && e.kind === 'step' && (
                  <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{info.sub}</span>
                )}
              </span>
              <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
                {e.ms !== undefined ? ms(e.ms) : clock(e.at)}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
