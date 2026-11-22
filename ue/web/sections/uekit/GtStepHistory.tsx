import { h, t } from '../../host.ts'
import { fmtTime } from '../../ui.tsx'
import { ms } from './gt-run/step-parts.tsx'
import { stepMark, type GtHistoryRun, type Mark, type MarkPlace } from './gt-step-history.ts'

export type { GtHistoryRun } from './gt-step-history.ts'

/**
 * 步骤详情的「最近几次」：场景最近 10 次运行（GameTest 1.2 的 gt.history，跨编辑器会话）里这一步过没过，
 * 在这一步失败的列出时间和原因，一眼看出是偶发还是一直挂。只记跑整份场景的运行，「从这一步开始」的临时运行不算。
 * 场景改过（revision 和现在不同）的那次，步骤序号可能对不上，标出来。
 * 录成段的场景按路径对（GameTest 1.11.2 的 failedPath）；更早的记录只有序号，分不出是段里哪一步，算「对不上」
 */
export function GtStepHistory({
  runs,
  row,
  hasBlocks,
  revision,
}: {
  runs: GtHistoryRun[]
  row: MarkPlace
  /** 场景里有块（录制段、如果、循环） */
  hasBlocks?: boolean
  revision?: number
}) {
  const { cn } = h()
  if (!runs.length) return <p className="ue:text-subtle">{t('这个场景还没有运行记录')}</p>
  const marks = runs.map((r) => stepMark(r, row, hasBlocks))
  const count = (m: Mark) => marks.filter((x) => x === m).length
  const fails = runs.filter((_, k) => marks[k] === 'f').slice(0, 5)
  const cells = [...marks].reverse()
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:inline-flex ue:h-3 ue:items-stretch ue:gap-px">
          {cells.map((m, k) => (
            <span
              key={k}
              className={cn(
                'ue:w-1 ue:rounded-[1px]',
                m === 'p' ? 'ue:bg-success' : m === 'f' ? 'ue:bg-danger' : 'ue:bg-sel',
              )}
            />
          ))}
        </span>
        <span className="ue:text-muted">
          {t('最近 {n} 次：通过 {p}，在这步失败 {f}，没跑到 {s}', {
            n: runs.length,
            p: count('p'),
            f: count('f'),
            s: count('n'),
          })}
          {count('u') > 0 && t('，{u} 次是旧记录、分不出段里哪一步', { u: count('u') })}
        </span>
      </div>
      {fails.map((r) => (
        <div key={r.runId} className="ue:flex ue:flex-col ue:gap-0.5">
          <span className="ue:flex ue:items-center ue:gap-2 ue:text-subtle">
            <span className="ue:tabular-nums">{r.startedAtUtc ? fmtTime(r.startedAtUtc) : r.runId}</span>
            {r.durationMs !== undefined && <span className="ue:tabular-nums">{ms(r.durationMs)}</span>}
            {revision !== undefined && r.revision !== undefined && r.revision !== revision && (
              <span className="ue:text-warning">{t('当时是 rev {r}，步骤可能已经变了', { r: r.revision })}</span>
            )}
          </span>
          {r.message && <span className="ue:whitespace-pre-wrap ue:break-all ue:text-danger">{r.message}</span>}
        </div>
      ))}
    </div>
  )
}
