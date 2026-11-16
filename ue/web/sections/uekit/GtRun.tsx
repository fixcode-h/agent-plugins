import {
  CircleStop,
  Copy,
  Crosshair,
  Loader2,
  MousePointerClick,
  Play,
  ScanSearch,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { op, ppost, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '../../menu.tsx'
import { Badge, ErrorText } from '../../ui.tsx'
import { coordClickAt } from './gt-steps.ts'
import { useToWidget } from './gt-convert.ts'
import type { GtBatch } from './GtBatch.tsx'
import {
  CheckMark,
  StepDetail,
  StepIcon,
  ms,
  rowSummary,
  type GtResolveItem,
  type GtStep,
  type StepDef,
  type StepRow,
} from './GtStepDetail.tsx'

/**
 * 一个场景：顶上一条结果（通过 / 失败 / 运行中和进度），中间列出场景文件里的每一步（没跑过也列），
 * 跑过的步骤带上状态和结果；右边是选中步骤的参数、结果和截图。
 * 场景文件由面板直接读（ext/gt/scenario）；运行中的结果来自推送事件（父组件拼好的 job），跑完的来自 gt.report
 */
export type { GtStep } from './GtStepDetail.tsx'

export interface GtJob {
  runId?: string
  name?: string
  status: string
  busy: boolean
  total: number
  planned?: number
  failed: number
  steps: GtStep[]
  /** 批量运行（GameTest 1.2）：两个场景之间 busy 也是 true */
  batch?: GtBatch
}

export interface GtRunSummary {
  runId: string
  name: string
  /** 跑的场景文件（相对场景根，GameTest 1.2 起）：场景重名时按它认 */
  scenario?: string
  succeeded: boolean
  total: number
  failed: number
  startedAtUtc?: string
  durationMs?: number
  outputDir?: string
}

export interface GtScenarioFile {
  name?: string
  _note?: string
  stepDelayMs?: number
  /** 1 的场景里 click / type 没写 via 时是旧的代码级操作（「从这一步开始运行」要照样补上） */
  schemaVersion?: number
  steps: StepDef[]
}

export function GtRun({
  scenario,
  root,
  job,
  last,
  offset = 0,
  onStop,
  onRunFrom,
  onChanged,
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
  /** 场景根的绝对路径（gt.scenarios 的 absoluteRootDir）：面板按它读场景文件 */
  root: string
  job?: GtJob
  last?: GtRunSummary
  /** 这次运行是从场景第几步开始的（「从这一步开始运行」）：结果的 index 加上它才对得上场景里的行 */
  offset?: number
  onStop: () => void
  /** 从第 i 步开始跑（右键菜单）：父组件拿场景文件里的步骤去 gt.run */
  onRunFrom?: (file: GtScenarioFile, i: number) => void
  /** 场景文件被面板改过（转成控件步骤）：父组件重新要场景列表，步数变了这里会重新读文件 */
  onChanged: () => void
}) {
  const { project } = useUe()
  const { ui, cn, toast } = h()
  const running = !!job?.busy
  const file = useLoad(
    () =>
      scenario.parseError
        ? Promise.resolve(undefined)
        : ppost<GtScenarioFile>(project.id, 'ext/gt/scenario', { root, path: scenario.relativePath }),
    [project.id, root, scenario.relativePath, scenario.revision, scenario.steps],
  )
  const report = useLoad(
    () => (!running && last ? loadReport(project.id, last.runId) : Promise.resolve(undefined)),
    [last?.runId, running],
  )
  const results = running ? (job?.steps ?? []) : (report.data ?? [])
  // 「核对选择器」的结果（gt.resolve，只看这一刻屏上的界面）：按步骤分好，场景文件变了就作废
  const [check, setCheck] = useState<{ found: number; missing: number; byStep: Map<number, GtResolveItem[]> }>()
  const [checking, setChecking] = useState(false)
  useEffect(() => setCheck(undefined), [file.data])
  const runCheck = () => {
    setChecking(true)
    op<{ results?: GtResolveItem[]; found?: number; missing?: number; file?: string }>(project.id, 'gt.resolve', {
      scenario: scenario.relativePath,
    })
      .then(async (r) => {
        // 结果太长时 UE 写成文件只回 file：由面板读那份文件
        const full = r.results ? r : await ppost<typeof r>(project.id, 'ext/gt/report', { file: r.file })
        const byStep = new Map<number, GtResolveItem[]>()
        for (const x of full.results ?? [])
          if (x.step !== undefined) byStep.set(x.step, [...(byStep.get(x.step) ?? []), x])
        setCheck({ found: full.found ?? 0, missing: full.missing ?? 0, byStep })
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setChecking(false))
  }
  const rows = useMemo(() => {
    const defs = file.data?.steps ?? []
    const byRow = new Map(results.map((r) => [r.index + offset, r]))
    const n = Math.max(defs.length, ...[...byRow.keys()].map((k) => k + 1))
    return Array.from(
      { length: n },
      (_, i): StepRow => ({ i, def: defs[i], res: byRow.get(i), check: check?.byStep.get(i) }),
    )
  }, [file.data, results, offset, check])
  const [pick, setPick] = useState<number>()
  // 运行中跟着最新一步走；跑完停在第一个失败的步骤上（没有失败、没跑过就第一步）
  useEffect(() => {
    const done = rows.filter((r) => r.res)
    if (running) setPick(done.at(-1)?.i ?? offset)
    else setPick((done.find((r) => r.res?.status === 'failed') ?? rows[0])?.i)
    // 只在结果数、行数变化时跳
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [running, results.length, rows.length])
  const row = rows.find((r) => r.i === pick)
  const planned = job?.planned || scenario.steps
  const liveRow = running ? (rows.filter((r) => r.res).at(-1)?.i ?? offset - 1) + 1 : -1
  const toWidget = useToWidget({ project: project.id, root, path: scenario.relativePath, onDone: onChanged })

  const stepMenu = (e: React.MouseEvent, r: StepRow) => {
    const s = rowSummary(r)
    const coord = file.data && coordClickAt(file.data.steps, r.i)
    openMenu(e, [
      { title: t('第 {n} 步 · {a}', { n: r.i + 1, a: r.def?.action || r.res?.action || '?' }) },
      onRunFrom &&
        file.data &&
        r.def && {
          label: t('从这一步开始运行'),
          icon: Play,
          disabled: running,
          onClick: () => onRunFrom(file.data!, r.i),
        },
      coord && {
        label: t('转成控件步骤'),
        icon: MousePointerClick,
        disabled: running || !!toWidget.busy,
        onClick: () => void toWidget.convert(file.data!, coord),
      },
      'sep',
      r.def && { label: t('复制这一步（JSON）'), icon: Copy, onClick: () => copyText(JSON.stringify(r.def, null, 2)) },
      s.target && { label: t('复制目标选择器'), icon: Crosshair, onClick: () => copyText(s.target!) },
      r.res?.message && { label: t('复制结果消息'), icon: Copy, onClick: () => copyText(r.res!.message!) },
    ])
  }

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
          <ui.IconButton
            icon={checking ? Loader2 : ScanSearch}
            size="sm"
            label={t('核对选择器：对着游戏里此刻的界面解析每一步的选择器，不执行（要开着 PIE）')}
            disabled={running || checking || !!scenario.parseError}
            onClick={runCheck}
          />
        </header>
        {check && (
          <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2 ue:text-footnote">
            <ScanSearch className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <span className="ue:min-w-0 ue:flex-1 ue:text-fg">
              {t(
                '核对了 {n} 个选择器：{f} 个找得到，{m} 个找不到。只看此刻屏上的界面，后面步骤才打开的界面找不到是正常的',
                {
                  n: check.found + check.missing,
                  f: check.found,
                  m: check.missing,
                },
              )}
            </span>
            <ui.IconButton icon={X} size="sm" label={t('清掉核对结果')} onClick={() => setCheck(undefined)} />
          </div>
        )}
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
          {(file.error || report.error) && (
            <div className="ue:flex ue:flex-col ue:gap-2 ue:p-4">
              {file.error && <ErrorText>{file.error}</ErrorText>}
              {report.error && <ErrorText>{report.error}</ErrorText>}
            </div>
          )}
          {!rows.length && file.loading && (
            <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
              <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
            </div>
          )}
          {rows.map((r) => {
            const sum = rowSummary(r)
            const status = r.res?.status
            return (
              <button
                key={r.i}
                type="button"
                onClick={() => setPick(r.i)}
                onContextMenu={(e) => {
                  setPick(r.i)
                  stepMenu(e, r)
                }}
                aria-selected={r.i === pick}
                className={cn(
                  'ue:grid ue:h-9 ue:w-full ue:cursor-pointer ue:grid-cols-[28px_18px_104px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4 ue:text-left ue:hover:bg-sel/50 ue:aria-selected:bg-sel',
                  status === 'failed' && 'ue:bg-danger/6',
                  !r.res && (running || last) && 'ue:opacity-60',
                )}
              >
                <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">{r.i + 1}</span>
                <StepIcon s={status} live={r.i === liveRow} />
                <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
                  <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                    {r.def?.action || r.res?.action}
                  </span>
                  <CheckMark check={r.check} />
                </span>
                {sum.human ? (
                  <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-footnote">
                    {sum.ambiguous && (
                      <span title={t('选择器可能不唯一：{r}', { r: sum.ambiguous })} className="ue:shrink-0">
                        <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:text-warning" />
                      </span>
                    )}
                    <span className="ue:min-w-0 ue:truncate ue:text-fg">{sum.human}</span>
                    {sum.target && (
                      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-subtle">{sum.target}</span>
                    )}
                    {r.res?.message && <span className="ue:truncate ue:text-muted">· {r.res.message}</span>}
                  </span>
                ) : (
                  <span className="ue:truncate ue:text-footnote ue:text-muted">
                    {sum.target && <span className="ue:font-mono">{sum.target}</span>}
                    {sum.target && sum.text ? ' · ' : ''}
                    {sum.text}
                  </span>
                )}
                <span className="ue:text-caption ue:text-subtle ue:tabular-nums">{ms(r.res?.durationMs)}</span>
              </button>
            )
          })}
        </div>
      </section>
      <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-col ue:lg:flex-1">
        {row ? <StepDetail row={row} live={row.i === liveRow} scenario={scenario} /> : null}
      </section>
    </div>
  )
}

/**
 * 一次运行每一步的结果：gt.report 直接回报告本身（不是 { report }）；超过 12000 字时 UE 把整份写进文件、
 * 只回 file，这时由面板读那份文件
 */
async function loadReport(project: string, runId: string): Promise<GtStep[]> {
  const r = await op<{ steps?: GtStep[]; truncated?: boolean; file?: string }>(project, 'gt.report', { runId })
  if (r.steps) return r.steps
  if (r.file) return (await ppost<{ steps?: GtStep[] }>(project, 'ext/gt/report', { file: r.file })).steps ?? []
  return []
}
