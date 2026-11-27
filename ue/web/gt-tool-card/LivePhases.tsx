import { useState } from 'react'
import { h, t } from '../host.ts'
import { StepIcon } from '../sections/uekit/gt-run/step-parts.tsx'
import type { GtJob } from '../sections/uekit/gt-run/types.ts'
import { groupPhases, type PhaseKey, type TreeRow } from '../sections/uekit/gt-rows/phases.ts'
import { PhaseRow, phaseSummary } from '../sections/uekit/gt-rows/PhaseHead.tsx'
import { liveStepLine } from './state.ts'

/** 正在跑的那段最多列这么多行：整份结果跑完后看报告 */
const LIVE_ROWS = 12

type Step = GtJob['steps'][number]

/**
 * 跑着时卡片展开的内容：按执行前 / 执行 / 执行后分三段（用户 2026-11-27），正在跑的那段展开，其余折成一行摘要（点开看），
 * 子脚本里的步骤缩进挂在调用那一步下面
 */
export function LivePhases({ job }: { job?: GtJob }) {
  const groups = groupPhases(job?.steps ?? [], { live: true, phase: job?.phase, phases: job?.phases })
  // 人点过的按人点的，没点过的跟着跑到哪段走
  const [manual, setManual] = useState<Partial<Record<PhaseKey, boolean>>>({})
  return (
    <div className="ue:flex ue:flex-col ue:divide-y ue:divide-line/60 ue:px-3 ue:py-1">
      {groups.map((g) => {
        const open = manual[g.phase] ?? g.state === 'running'
        const canOpen = g.rows.length > 0
        return (
          <div key={g.phase} className="ue:py-0.5">
            <PhaseRow
              phase={g.phase}
              state={g.state}
              summary={phaseSummary(g.state, g.done, g.total)}
              open={open && canOpen}
              onToggle={canOpen ? () => setManual((m) => ({ ...m, [g.phase]: !open })) : undefined}
            />
            {open && canOpen && (
              <ul className="ue:flex ue:flex-col ue:gap-1 ue:pb-1">
                {g.rows.slice(-LIVE_ROWS).map((row, i) => (
                  <LiveRow key={i} row={row} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {!job?.steps.length && <p className="ue:py-1 ue:text-subtle">{t('等第一步的结果…')}</p>}
    </div>
  )
}

function LiveRow({ row }: { row: TreeRow<Step> }) {
  const { cn } = h()
  const pad = { paddingLeft: 22 + row.depth * 18 }
  if (!row.step)
    // 子脚本还在跑：调用那一步的记录要等它跑完才有，先列一行占位，子步骤挂在下面
    return (
      <li className="ue:flex ue:min-w-0 ue:items-center ue:gap-2" style={pad}>
        <StepIcon live />
        <span className="ue:truncate ue:text-muted">{t('调用 {name}', { name: row.key })}</span>
      </li>
    )
  const s = row.step
  const line = liveStepLine(s)
  const bad = s.status === 'failed' && !s.warn
  return (
    <li className="ue:flex ue:min-w-0 ue:items-center ue:gap-2" style={pad} title={line.detail || undefined}>
      <StepIcon s={s.warn ? 'warned' : s.status} />
      <span
        className={cn(
          line.code ? 'ue:shrink-0 ue:font-mono ue:text-muted' : 'ue:min-w-0 ue:truncate ue:font-medium',
          !line.code && (bad ? 'ue:text-danger' : 'ue:text-fg'),
        )}
      >
        {line.title}
      </span>
      {line.detail && (
        <span className={cn('ue:min-w-0 ue:flex-1 ue:truncate', bad ? 'ue:text-danger' : 'ue:text-subtle')}>
          {line.detail}
        </span>
      )}
    </li>
  )
}
