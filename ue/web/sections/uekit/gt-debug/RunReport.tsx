import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { ErrorText } from '../../../ui.tsx'
import { loadReport } from '../gt-run/types.ts'
import { ms, StepIcon, type GtStep as ReportStep } from '../gt-run/step-parts.tsx'
import { titleOfKey } from './lookup.ts'
import { ReportValues } from './ReportValues.tsx'
import { groupPhases, outcomeOf, type TreeRow } from '../gt-rows/phases.ts'
import { PhaseRow, phaseSummary } from '../gt-rows/PhaseHead.tsx'

/**
 * 「报告」页：这次运行跑完后读 gt.report（协议第 11 节：每步带 id、path，块结束记一条 block），
 * 按执行顺序列出，失败的写原因、每步下面列调函数的返回值和这一步用到的变量当时的值（payload.vars，GameTest 1.11.2 起），
 * 按值树画、点开看（以前压成一行文字，对象和表看不全）；
 * 点一行选中那一步。跑着时不读（报告还没写完）
 */
export function RunReport({
  project,
  runId,
  active,
  doc,
  onSelect,
  disk,
}: {
  project: string
  runId?: string
  active: boolean
  /** 编辑器没连上：由面板从磁盘读报告 */
  disk?: boolean
  doc?: GtScript
  onSelect: (p: GtPath) => void
}) {
  const { cn } = h()
  const [steps, setSteps] = useState<ReportStep[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    setSteps(undefined)
    setError('')
    if (!runId || active) return
    let off = false
    loadReport(project, runId, !!disk)
      .then((s) => !off && setSteps(s))
      .catch((e: Error) => !off && setError(e.message))
    return () => {
      off = true
    }
  }, [project, runId, active, disk])

  if (!runId)
    return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('还没在这里跑过：跑完后这里是这次运行的报告')}</p>
  if (active) return <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('跑完后出报告；跑着时看「运行记录」')}</p>
  if (error)
    return (
      <div className="ue:p-4">
        <ErrorText>{error}</ErrorText>
      </div>
    )
  if (!steps)
    return (
      <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
        <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
      </div>
    )
  // 附带 GM 外面包的那层（<路径>#hooks）不列：主步骤和每条附带 GM 各有一条记录
  const list = steps.filter((s) => !String(s.path ?? '').endsWith('#hooks'))
  const failed = list.filter((s) => s.status === 'failed' && !s.warn).length
  const warned = list.filter((s) => s.warn).length
  const outcome = outcomeOf(list)
  const firstBad = list.find((s) => s.status === 'failed' && !s.warn)
  const groups = groupPhases(list, {
    live: false,
    totals: doc && {
      setup: doc.setup?.length ?? 0,
      steps: doc.steps?.length ?? 0,
      teardown: doc.teardown?.length ?? 0,
    },
  })
  return (
    <div className="ue:flex ue:flex-col">
      <p
        className={cn(
          'ue:px-4 ue:py-2 ue:text-footnote',
          outcome === 'blocked' ? 'ue:text-warning' : failed ? 'ue:text-danger' : 'ue:text-success',
        )}
      >
        {outcome === 'blocked' ? t('前置不满足：测试没开始') : failed ? t('{n} 步失败', { n: failed }) : t('全部通过')}
        {warned > 0 && <span className="ue:ml-2 ue:text-warning">{t('{n} 条警告', { n: warned })}</span>}
        <span className="ue:ml-2 ue:text-subtle">{t('共 {n} 条记录', { n: list.length })}</span>
      </p>
      {outcome === 'blocked' && firstBad && (
        <p className="ue:mx-4 ue:mb-2 ue:rounded-md ue:bg-warning/10 ue:px-3 ue:py-2 ue:text-footnote ue:text-fg">
          <span className="ue:font-medium ue:text-warning">{firstBad.title || firstBad.note || firstBad.action}</span>
          {firstBad.message && ` · ${firstBad.message}`}
          <span className="ue:block ue:text-subtle">{t('先补上前置（配置、资源、环境）再跑，不要改测试脚本')}</span>
        </p>
      )}
      {groups.map((g) => (
        <section key={g.phase} className="ue:border-t ue:border-line/60 ue:px-2">
          <PhaseRow phase={g.phase} state={g.state} summary={phaseSummary(g.state, g.done, g.total)} />
          <ol className="ue:flex ue:flex-col">
            {g.rows.map((row, i) => (
              <ReportRow key={i} row={row} doc={doc} project={project} onSelect={onSelect} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

/** 报告的一行：子脚本里的步骤（calls）按层缩进；调用还没记录时只有占位 */
function ReportRow({
  row,
  doc,
  project,
  onSelect,
}: {
  row: TreeRow<ReportStep>
  doc?: GtScript
  project: string
  onSelect: (p: GtPath) => void
}) {
  const { cn } = h()
  const s = row.step
  if (!s)
    return (
      <li className="ue:py-1 ue:pr-4 ue:text-footnote ue:text-muted" style={{ paddingLeft: 16 + row.depth * 18 }}>
        {t('调用 {name}', { name: row.key })}
      </li>
    )
  // 子脚本里的步骤路径相对子脚本：不对到这份脚本的节点上
  const info = s.calls?.length ? { path: undefined, title: '' } : titleOfKey(doc, String(s.id ?? s.path ?? ''))
  const block = s.block === true
  // 附带 GM（<路径>.hooks.<组>.<序号>）缩在它那一步底下
  const hook = String(s.path ?? '').includes('.hooks.')
  return (
    <li>
      <button
        type="button"
        disabled={!info.path}
        onClick={() => info.path && onSelect(info.path)}
        style={{ paddingLeft: 16 + (row.depth + (hook ? 1 : 0)) * 18 }}
        className={cn(
          'ue:flex ue:w-full ue:items-start ue:gap-2 ue:py-1.5 ue:pr-4 ue:text-left',
          info.path && 'ue:cursor-pointer ue:hover:bg-hover',
        )}
      >
        <span className="ue:mt-0.5 ue:shrink-0">
          <StepIcon s={s.warn ? 'warned' : s.status} />
        </span>
        <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
          <span className={cn('ue:truncate ue:text-footnote', block ? 'ue:text-muted' : 'ue:text-fg')}>
            {info.path ? info.title : s.title || s.note || s.action}
            {block && s.action !== 'call' && ` · ${t('整块')}`}
          </span>
          {s.status === 'failed' && s.message && (
            <span className={cn('ue:text-caption ue:break-words', s.warn ? 'ue:text-warning' : 'ue:text-danger')}>
              {s.message}
            </span>
          )}
        </span>
        <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">
          {ms(s.durationMs)}
          {!!s.pausedMs && (
            <span
              className="ue:ml-1.5 ue:text-run"
              title={t('这一步中途被打断了 {d}（断点、长加载或对话框），这段时间不算用时和超时', { d: ms(s.pausedMs) })}
            >
              {t('停了 {d}', { d: ms(s.pausedMs) })}
            </span>
          )}
        </span>
      </button>
      <ReportValues project={project} payload={s.payload} />
    </li>
  )
}
