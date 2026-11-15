import { CircleCheck, CircleDashed, CircleStop, CircleX, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, ErrorText, Term } from '../../ui.tsx'

/**
 * 一个场景的运行结果：顶上一条结果（通过 / 失败 / 运行中和进度），中间每一步一行，右边是选中步骤的目标、说明、
 * 结果和截图。运行中的步骤来自推送事件（父组件拼好的 job），跑完的来自 gt.report。
 */
export interface GtStep {
  index: number
  action: string
  status: 'succeeded' | 'failed' | 'skipped' | 'pending' | string
  message?: string
  target?: string
  note?: string
  payload?: Record<string, unknown>
  durationMs?: number
}

export interface GtJob {
  runId?: string
  name?: string
  status: string
  busy: boolean
  total: number
  planned?: number
  failed: number
  steps: GtStep[]
}

export interface GtRunSummary {
  runId: string
  name: string
  succeeded: boolean
  total: number
  failed: number
  startedAtUtc?: string
  durationMs?: number
  outputDir?: string
}

const ms = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`)

function StepIcon({ s, live }: { s: string; live?: boolean }) {
  if (live) return <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin ue:text-warning" />
  if (s === 'succeeded') return <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
  if (s === 'failed') return <CircleX className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
  return <CircleDashed className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
}

export function GtRun({
  scenario,
  job,
  last,
  onStop,
}: {
  scenario: {
    name: string
    relativePath: string
    steps: number
    revision?: number
    tags?: string[]
    _note?: string
    parseError?: string
  }
  job?: GtJob
  last?: GtRunSummary
  onStop: () => void
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const running = !!job?.busy
  const report = useLoad(
    () =>
      !running && last
        ? op<{ report: { steps: GtStep[]; succeeded: boolean; durationMs?: number } }>(project.id, 'gt.report', {
            runId: last.runId,
          }).then((r) => r.report)
        : Promise.resolve(undefined),
    [last?.runId, running],
  )
  const steps = running ? (job?.steps ?? []) : (report.data?.steps ?? [])
  const [pick, setPick] = useState<number>()
  // 运行中跟着最新一步走；跑完停在第一个失败的步骤上（没有失败就第一步）
  useEffect(() => {
    if (running) setPick(steps.at(-1)?.index)
    else if (steps.length) setPick((steps.find((s) => s.status === 'failed') ?? steps[0]).index)
    // 只在步骤数变化时跳
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [running, steps.length])
  const step = steps.find((s) => s.index === pick)
  const planned = job?.planned || scenario.steps

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:lg:flex-row ue:lg:overflow-hidden">
      <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-col ue:lg:flex-[1.2] ue:lg:border-r ue:lg:border-line">
        <header className="ue:flex ue:min-h-12 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
          <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{scenario.name}</span>
          {(scenario.tags ?? []).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
          {scenario.revision ? <Badge>rev {scenario.revision}</Badge> : null}
          <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
            {scenario.relativePath}
          </span>
        </header>
        {scenario.parseError ? (
          <div className="ue:p-4">
            <ErrorText>{scenario.parseError}</ErrorText>
          </div>
        ) : running && job ? (
          <div className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-4 ue:py-2.5 ue:text-footnote">
            <Loader2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:animate-spin ue:text-warning" />
            <span className="ue:font-medium ue:text-fg">
              {t('运行中 · 第 {n} / {m} 步', { n: Math.min(job.total + 1, planned), m: planned })}
            </span>
            <div className="ue:h-1 ue:min-w-12 ue:flex-1 ue:overflow-hidden ue:rounded-full ue:bg-sel">
              <div className="ue:h-full ue:bg-run" style={{ width: `${planned ? (job.total / planned) * 100 : 0}%` }} />
            </div>
            <ui.Button size="sm" variant="secondary" onClick={onStop}>
              <CircleStop className="ue:h-3.5 ue:w-3.5" /> {t('停止')}
            </ui.Button>
          </div>
        ) : last ? (
          <div
            className={cn(
              'ue:flex ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-1 ue:border-b ue:border-line ue:px-4 ue:py-2.5 ue:text-footnote',
              last.succeeded ? 'ue:bg-success/7' : 'ue:bg-danger/7',
            )}
          >
            <StepIcon s={last.succeeded ? 'succeeded' : 'failed'} />
            <span className="ue:font-medium ue:text-fg">
              {last.succeeded
                ? t('通过 · {n} 步 · {d}', { n: last.total, d: ms(last.durationMs) })
                : t('失败 · {f} / {n} 步没过', { f: last.failed, n: last.total })}
            </span>
            {last.outputDir && <code className="ue:truncate ue:font-mono ue:text-subtle">{last.outputDir}</code>}
          </div>
        ) : (
          <p className="ue:border-b ue:border-line ue:px-4 ue:py-2.5 ue:text-footnote ue:text-subtle">
            {t('编辑器这次启动后还没跑过这个场景（{n} 步），点「运行」跑一遍', { n: scenario.steps })}
          </p>
        )}
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
          {report.error && (
            <div className="ue:p-4">
              <ErrorText>{report.error}</ErrorText>
            </div>
          )}
          {steps.map((s, i) => (
            <button
              key={s.index}
              type="button"
              onClick={() => setPick(s.index)}
              aria-selected={s.index === pick}
              className={cn(
                'ue:grid ue:h-9 ue:w-full ue:cursor-pointer ue:grid-cols-[22px_18px_104px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4 ue:text-left ue:hover:bg-sel/50 ue:aria-selected:bg-sel',
                s.status === 'failed' && 'ue:bg-danger/6',
              )}
            >
              <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">{s.index + 1}</span>
              <StepIcon s={s.status} live={running && i === steps.length - 1 && s.status === 'pending'} />
              <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{s.action}</span>
              <span className="ue:truncate ue:text-footnote ue:text-muted">
                {s.target && <span className="ue:font-mono">{s.target}</span>}
                {s.target && (s.note || s.message) ? ' · ' : ''}
                {s.note || s.message}
              </span>
              <span className="ue:text-caption ue:text-subtle ue:tabular-nums">{ms(s.durationMs)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-col ue:lg:flex-1">
        {step ? <StepDetail step={step} /> : null}
      </section>
    </div>
  )
}

/** 一步的详情：目标、说明、结果，payload 里有截图（path 是 png）就显示出来 */
function StepDetail({ step }: { step: GtStep }) {
  const { project } = useUe()
  const { api } = h()
  const shot = [step.payload?.path, step.payload?.screenshot, step.payload?.annotated].find(
    (p): p is string => typeof p === 'string' && /\.(png|jpe?g)$/i.test(p),
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto">
      <header className="ue:flex ue:min-h-12 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
        <span className="ue:text-caption ue:text-subtle">{t('第 {n} 步', { n: step.index + 1 })}</span>
        <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">{step.action}</span>
        <StepIcon s={step.status} />
        <span className="ue:ml-auto ue:text-caption ue:text-subtle">{ms(step.durationMs)}</span>
      </header>
      <dl className="ue:grid ue:grid-cols-[64px_1fr] ue:gap-x-3 ue:gap-y-1.5 ue:border-b ue:border-line ue:px-4 ue:py-3 ue:text-footnote">
        {step.target && (
          <>
            <dt className="ue:text-subtle">{t('目标')}</dt>
            <dd className="ue:min-w-0 ue:font-mono ue:break-all ue:text-fg">{step.target}</dd>
          </>
        )}
        {step.note && (
          <>
            <dt className="ue:text-subtle">{t('说明')}</dt>
            <dd className="ue:text-fg">{step.note}</dd>
          </>
        )}
        <dt className="ue:text-subtle">{t('结果')}</dt>
        <dd className={step.status === 'failed' ? 'ue:text-danger' : 'ue:text-fg'}>{step.message || '—'}</dd>
      </dl>
      {shot && (
        <img
          alt={t('步骤截图')}
          src={api.url(`/p/${encodeURIComponent(project.id)}/ext/file?path=${encodeURIComponent(shot)}`)}
          className="ue:mx-4 ue:mt-3 ue:rounded-lg ue:border ue:border-line"
        />
      )}
      {step.payload && Object.keys(step.payload).length > 0 && (
        <div className="ue:p-4">
          <Term>
            <pre className="ue:whitespace-pre-wrap">{JSON.stringify(step.payload, null, 2)}</pre>
          </Term>
        </div>
      )}
    </div>
  )
}
