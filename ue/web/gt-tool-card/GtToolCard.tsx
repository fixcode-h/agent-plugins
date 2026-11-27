import { ChevronDown, ChevronRight, ExternalLink, FlaskConical } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ToolCardProps } from '../../../sdk/web.ts'
import { op } from '../api.ts'
import { h, t } from '../host.ts'
import { mergeJobEvent } from '../sections/uekit/gt-batch.ts'
import { RunReport } from '../sections/uekit/gt-debug/RunReport.tsx'
import { loadReport, type GtJob } from '../sections/uekit/gt-run/types.ts'
import { useExtEvents } from '../sections/uekit/ListCol.tsx'
import { Badge, type Tone } from '../ui.tsx'
import { gametestRoute, runSub } from './link.ts'
import { phaseProgress, runPhase, runResult, runTarget, tallyOf, type RunPhase, type RunTally } from './state.ts'
import { LivePhases } from './LivePhases.tsx'

const PHASE: Record<RunPhase, { tone: Tone; label: () => string }> = {
  starting: { tone: 'run', label: () => t('启动中') },
  running: { tone: 'run', label: () => t('运行中') },
  passed: { tone: 'ok', label: () => t('通过') },
  failed: { tone: 'danger', label: () => t('失败') },
  blocked: { tone: 'warn', label: () => t('前置不满足') },
  error: { tone: 'danger', label: () => t('没跑起来') },
  unknown: { tone: 'muted', label: () => t('已结束') },
}

/** 打开卡片时向作业要最近这么多步（之后靠推送接上）：分段显示要看得到前面几段 */
const LIVE_STEPS = 50

/**
 * 对话里 Agent 调 ue_gametest action=run 那一行下面的卡片（用户 2026-11-26：要看得出 Agent 跑了哪个脚本、跑得怎样）。
 * 收起时一行：脚本、状态、跑到第几步；展开：跑着时列最近几步（gt.job 推送，不轮询），跑完后是和 GameTest 页同一份报告（RunReport）。
 * 「在 GameTest 页打开」跳到那个脚本并在右栏打开这次运行
 */
export function GtToolCard({ args, output, running, failed, projectId }: ToolCardProps) {
  const { hooks } = h()
  const nav = hooks.useNav()
  const target = runTarget(args)
  const res = runResult(output)
  const [job, setJob] = useState<GtJob>()
  const [tally, setTally] = useState<RunTally>()
  const [open, setOpen] = useState(false)
  const project = projectId ?? ''

  // 打开对话时这次运行可能早就跑完、或者还在跑：查一次作业现状，之后靠推送
  useEffect(() => {
    if (!project || !res.runId) return
    let off = false
    const runId = res.runId
    op<GtJob>(project, 'gt.job', { steps: LIVE_STEPS })
      .then(async (j) => {
        if (off) return
        if (j.runId === runId) return setJob(j)
        // 作业已经是别的运行了：这次早跑完了，读一次报告定通过没有
        const steps = await loadReport(project, runId, false)
        if (!off) setTally(tallyOf(steps))
      })
      .catch(() => undefined)
    return () => {
      off = true
    }
  }, [project, res.runId])
  useExtEvents(project, (e) => {
    if (e.event !== 'gt.job') return
    const j = e as unknown as GtJob & { lastStep?: GtJob['steps'][number] }
    if (j.runId && j.runId === res.runId) setJob((old) => mergeJobEvent(old, j))
  })

  const phase = runPhase({ calling: running, failed, error: res.error, runId: res.runId, job, tally })
  const total = job?.planned ?? res.planned
  const done = job?.total ?? tally?.total ?? 0
  const live = phase === 'running' || phase === 'starting'
  const progress = live ? phaseProgress(job) : undefined
  const goPage = () =>
    target.scenario &&
    nav.go({ page: 'plugin', id: 'ue', sub: 'main', msg: gametestRoute(project, runSub(target.scenario, res.runId)) })

  return (
    <div data-gt-tool-card={phase} className="ue:text-footnote">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:px-2.5 ue:py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ue:flex ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:text-left"
        >
          {open ? (
            <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          ) : (
            <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          )}
          <FlaskConical className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
          <span className="ue:shrink-0 ue:text-muted">GameTest</span>
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg" title={target.scenario ?? target.label}>
            {target.label || t('临时步骤')}
          </span>
          <Badge tone={PHASE[phase].tone}>{PHASE[phase].label()}</Badge>
          {total !== undefined && (live || job || tally) && (
            <span className="ue:shrink-0 ue:text-subtle">
              {progress ?? (live ? t('第 {n}/{m} 步', { n: done, m: total }) : t('{n} 步', { n: done || total }))}
              {!!(job?.failed ?? tally?.failed) && ` · ${t('失败 {n} 步', { n: job?.failed ?? tally?.failed ?? 0 })}`}
            </span>
          )}
        </button>
        {target.scenario && project && (
          <button
            type="button"
            onClick={goPage}
            className="ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:text-subtle ue:hover:text-fg"
          >
            <ExternalLink className="ue:h-3 ue:w-3" /> {t('在 GameTest 页打开')}
          </button>
        )}
      </div>
      {open && (
        <div className="ue:border-t ue:border-line">
          {res.error ? (
            <p className="ue:px-3 ue:py-2 ue:text-danger">{res.error}</p>
          ) : live ? (
            <LivePhases job={job} />
          ) : res.runId && project ? (
            <div className="ue:max-h-96 ue:overflow-auto">
              <RunReport project={project} runId={res.runId} active={false} onSelect={() => undefined} />
            </div>
          ) : (
            <p className="ue:px-3 ue:py-2 ue:text-subtle">{t('没有这次运行的记录')}</p>
          )}
        </div>
      )}
    </div>
  )
}
