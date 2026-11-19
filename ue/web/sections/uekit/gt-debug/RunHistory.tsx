import { CircleCheck, CircleX } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { fmtTime } from '../../../ui.tsx'
import type { GtHistoryRun } from '../gt-step-history.ts'
import { ms } from '../GtStepDetail.tsx'

/**
 * 运行面板的「历史」页：这个脚本最近几次运行（gt.history，跨编辑器会话，最新在前）。
 * 原来在运行结果页的「最近运行」，那一页取消后挪到这里；点一次看那次的报告
 */
export function RunHistory({
  runs,
  current,
  onOpen,
}: {
  runs?: GtHistoryRun[]
  /** 报告页正在看的那次 */
  current?: string
  onOpen: (runId: string) => void
}) {
  const { cn } = h()
  if (!runs) return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('装着的 GameTest 还不记运行历史')}</p>
  if (!runs.length) return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('这个场景还没有运行记录')}</p>
  return (
    <ol className="ue:flex ue:flex-col ue:py-1">
      {runs.map((r) => (
        <li key={r.runId}>
          <button
            type="button"
            onClick={() => onOpen(r.runId)}
            className={cn(
              'ue:flex ue:w-full ue:cursor-pointer ue:items-start ue:gap-2 ue:px-4 ue:py-1.5 ue:text-left ue:text-footnote ue:hover:bg-sel/60',
              current === r.runId && 'ue:bg-sel',
            )}
          >
            {r.succeeded ? (
              <CircleCheck className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
            ) : (
              <CircleX className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
            )}
            <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
              <span className="ue:text-fg">
                {r.startedAtUtc ? fmtTime(r.startedAtUtc) : r.runId}
                {r.durationMs !== undefined && <span className="ue:ml-2 ue:text-subtle">{ms(r.durationMs)}</span>}
              </span>
              {!r.succeeded && r.message && <span className="ue:truncate ue:text-danger">{r.message}</span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
