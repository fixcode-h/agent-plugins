import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { ErrorText } from '../../../ui.tsx'
import { loadReport } from '../gt-run/types.ts'
import { ms, StepIcon, type GtStep as ReportStep } from '../gt-run/step-parts.tsx'
import { titleOfKey } from './lookup.ts'
import { ReportValues } from './ReportValues.tsx'

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
  return (
    <div className="ue:flex ue:flex-col">
      <p className={cn('ue:px-4 ue:py-2 ue:text-footnote', failed ? 'ue:text-danger' : 'ue:text-success')}>
        {failed ? t('{n} 步失败', { n: failed }) : t('全部通过')}
        {warned > 0 && <span className="ue:ml-2 ue:text-warning">{t('{n} 条附带 GM 出错', { n: warned })}</span>}
        <span className="ue:ml-2 ue:text-subtle">{t('共 {n} 条记录', { n: list.length })}</span>
      </p>
      <ol className="ue:flex ue:flex-col">
        {list.map((s, i) => {
          const key = String((s as { id?: unknown }).id ?? (s as { path?: unknown }).path ?? '')
          const info = titleOfKey(doc, key)
          const block = (s as { block?: unknown }).block === true
          // 附带 GM（<路径>.hooks.<组>.<序号>）缩在它那一步底下
          const hook = String(s.path ?? '').includes('.hooks.')
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!info.path}
                onClick={() => info.path && onSelect(info.path)}
                className={cn(
                  'ue:flex ue:w-full ue:items-start ue:gap-2 ue:py-1.5 ue:pr-4 ue:text-left',
                  hook ? 'ue:pl-9' : 'ue:pl-4',
                  info.path && 'ue:cursor-pointer ue:hover:bg-hover',
                )}
              >
                <span className="ue:mt-0.5 ue:shrink-0">
                  <StepIcon s={s.warn ? 'warned' : s.status} />
                </span>
                <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
                  <span className={cn('ue:truncate ue:text-footnote', block ? 'ue:text-muted' : 'ue:text-fg')}>
                    {info.path ? info.title : s.title || s.note || s.action}
                    {block && ` · ${t('整块')}`}
                  </span>
                  {s.status === 'failed' && s.message && (
                    <span className={cn('ue:text-caption ue:break-words', s.warn ? 'ue:text-warning' : 'ue:text-danger')}>
                      {s.message}
                    </span>
                  )}
                </span>
                <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">{ms(s.durationMs)}</span>
              </button>
              <ReportValues project={project} payload={s.payload} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}
