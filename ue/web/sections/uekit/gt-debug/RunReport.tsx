import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { ErrorText } from '../../../ui.tsx'
import { loadReport } from '../GtRun.tsx'
import { ms, StepIcon, type GtStep as ReportStep } from '../GtStepDetail.tsx'
import { titleOfKey } from './lookup.ts'

/**
 * 「报告」页：这次运行跑完后读 gt.report（协议第 11 节：每步带 id、path，块结束记一条 block），
 * 按执行顺序列出，失败的写原因；点一行选中那一步。跑着时不读（报告还没写完）
 */
export function RunReport({
  project,
  runId,
  active,
  doc,
  onSelect,
}: {
  project: string
  runId?: string
  active: boolean
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
    loadReport(project, runId, false)
      .then((s) => !off && setSteps(s))
      .catch((e: Error) => !off && setError(e.message))
    return () => {
      off = true
    }
  }, [project, runId, active])

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
  const failed = steps.filter((s) => s.status === 'failed').length
  return (
    <div className="ue:flex ue:flex-col">
      <p className={cn('ue:px-4 ue:py-2 ue:text-footnote', failed ? 'ue:text-danger' : 'ue:text-success')}>
        {failed ? t('{n} 步失败', { n: failed }) : t('全部通过')}
        <span className="ue:ml-2 ue:text-subtle">{t('共 {n} 条记录', { n: steps.length })}</span>
      </p>
      <ol className="ue:flex ue:flex-col">
        {steps.map((s, i) => {
          const key = String((s as { id?: unknown }).id ?? (s as { path?: unknown }).path ?? '')
          const info = titleOfKey(doc, key)
          const block = (s as { block?: unknown }).block === true
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!info.path}
                onClick={() => info.path && onSelect(info.path)}
                className={cn(
                  'ue:flex ue:w-full ue:items-start ue:gap-2 ue:px-4 ue:py-1.5 ue:text-left',
                  info.path && 'ue:cursor-pointer ue:hover:bg-hover',
                )}
              >
                <span className="ue:mt-0.5 ue:shrink-0">
                  <StepIcon s={s.status} />
                </span>
                <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
                  <span className={cn('ue:truncate ue:text-footnote', block ? 'ue:text-muted' : 'ue:text-fg')}>
                    {info.path ? info.title : s.note || s.action}
                    {block && ` · ${t('整块')}`}
                  </span>
                  {s.status === 'failed' && s.message && (
                    <span className="ue:text-caption ue:break-words ue:text-danger">{s.message}</span>
                  )}
                </span>
                <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">{ms(s.durationMs)}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
