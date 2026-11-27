import { useState } from 'react'
import { h, t } from '../host.ts'
import { StepIcon } from '../sections/uekit/gt-run/step-parts.tsx'
import type { GtJob } from '../sections/uekit/gt-run/types.ts'
import { groupPhases, pendingRows, type PhaseKey, type TreeRow } from '../sections/uekit/gt-rows/phases.ts'
import { PhaseRow, phaseSummary } from '../sections/uekit/gt-rows/PhaseHead.tsx'
import { stepTitle } from '../sections/uekit/gt-step-title.ts'
import { liveStepLine } from './state.ts'

/** 正在跑的那段最多列这么多行：整份结果跑完后看报告 */
const LIVE_ROWS = 12
/** 列不下时，已跑完的留最近几步，其余位置给下一步和后面的 */
const DONE_KEEP = 5

type Step = GtJob['steps'][number]
/** 脚本三段的顶层步骤（ext/gt/outline）：还没跑到的也列出来 */
export type GtOutline = Partial<Record<PhaseKey, Record<string, unknown>[]>>

/**
 * 跑着时卡片展开的内容：按执行前 / 执行 / 执行后分三段（用户 2026-11-27），正在跑的那段展开，其余折成一行摘要（点开看），
 * 子脚本里的步骤缩进挂在调用那一步下面；还没跑到的步骤也列出来，不打勾，跑完才打勾
 */
export function LivePhases({ job, outline }: { job?: GtJob; outline?: GtOutline }) {
  const steps = job?.steps ?? []
  const groups = groupPhases(steps, { live: true, phase: job?.phase, phases: job?.phases })
  // 人点过的按人点的，没点过的跟着跑到哪段走
  const [manual, setManual] = useState<Partial<Record<PhaseKey, boolean>>>({})
  return (
    <div className="ue:flex ue:flex-col ue:divide-y ue:divide-line/60 ue:px-3 ue:py-1">
      {groups.map((g) => {
        const def = outline?.[g.phase]
        const waiting = g.state === 'running' || g.state === 'pending'
        const later = waiting ? pendingRows(g.phase, steps, g.rows, def, g.state === 'running') : []
        const all = [...g.rows, ...later]
        const open = manual[g.phase] ?? g.state === 'running'
        const canOpen = all.length > 0
        // 列不下时：已跑完的留最近几步，接着是下一步和后面的
        const start = Math.max(0, Math.min(g.rows.length - DONE_KEEP, all.length - LIVE_ROWS))
        const shown = all.slice(start, start + LIVE_ROWS)
        const after = all.length - start - shown.length
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
                {start > 0 && <More text={t('前面 {n} 步已跑完', { n: start })} />}
                {shown.map((row, i) => (
                  <LiveRow key={start + i} row={row} outline={def} />
                ))}
                {after > 0 && <More text={t('后面还有 {n} 步', { n: after })} />}
              </ul>
            )}
          </div>
        )
      })}
      {!steps.length && !outline && <p className="ue:py-1 ue:text-subtle">{t('等第一步的结果…')}</p>}
    </div>
  )
}

function More({ text }: { text: string }) {
  return (
    <li className="ue:text-caption ue:text-subtle" style={{ paddingLeft: 22 }}>
      {text}
    </li>
  )
}

/** 调用占位行、没跑到的行显示的名称：脚本里写的名称 / 按动作拼的一句 */
const nameOf = (key: string, outline?: Record<string, unknown>[]) => {
  const def = outline?.find((d) => d.id === key)
  return def ? stepTitle(def) : t('调用 {name}', { name: key })
}

function LiveRow({ row, outline }: { row: TreeRow<Step>; outline?: Record<string, unknown>[] }) {
  const { cn } = h()
  const pad = { paddingLeft: 22 + row.depth * 18 }
  if (row.pending)
    // 还没跑到：空心圈、淡色；下一个要跑的转圈
    return (
      <li
        data-gt-pending={row.next ? 'next' : 'later'}
        className="ue:flex ue:min-w-0 ue:items-center ue:gap-2"
        style={pad}
      >
        <StepIcon live={row.next} />
        <span className={cn('ue:min-w-0 ue:truncate', row.next ? 'ue:text-fg' : 'ue:text-subtle')}>
          {stepTitle(row.pending)}
        </span>
      </li>
    )
  if (!row.step)
    // 子脚本还在跑：调用那一步的记录要等它跑完才有，先列一行占位，子步骤挂在下面
    return (
      <li className="ue:flex ue:min-w-0 ue:items-center ue:gap-2" style={pad}>
        <StepIcon live />
        <span className="ue:truncate ue:text-fg">{nameOf(row.key, outline)}</span>
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
