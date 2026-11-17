import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../host.ts'
import { ms, StepIcon, type GtStep } from './GtStepDetail.tsx'

/**
 * 运行配置里的前置步骤（GameTest 1.2.5 的 setup）这次跑的结果：不占场景的步骤序号，单独一块放在步骤列表上方。
 * 都成功时折成一行，有失败时默认展开（场景一步都没跑，原因在这里）
 */
export function GtSetupRows({ steps }: { steps: GtStep[] }) {
  const failed = steps.some((s) => s.status === 'failed')
  const [open, setOpen] = useState(failed)
  if (!steps.length) return null
  const expanded = open || failed
  return (
    <div className="ue:border-b ue:border-line">
      <button
        type="button"
        className="ue:flex ue:w-full ue:items-center ue:gap-2 ue:px-4 ue:py-1.5 ue:text-left ue:text-footnote ue:text-subtle ue:hover:bg-hover"
        onClick={() => setOpen(!expanded)}
      >
        <ChevronRight className={expanded ? 'ue:h-3 ue:w-3 ue:rotate-90' : 'ue:h-3 ue:w-3'} />
        <span>{t('前置步骤 {n} 步', { n: steps.length })}</span>
        <span className={failed ? 'ue:text-danger' : ''}>{failed ? t('有失败，场景没开始') : t('都完成了')}</span>
      </button>
      {expanded &&
        steps.map((s) => (
          <div key={s.index} className="ue:flex ue:items-center ue:gap-2 ue:py-1 ue:pr-4 ue:pl-8 ue:text-footnote">
            <StepIcon s={s.status} />
            <span className="ue:shrink-0 ue:text-subtle">{t('前置第 {n} 步', { n: s.index + 1 })}</span>
            <span className="ue:shrink-0 ue:font-mono ue:text-muted">{s.action}</span>
            <span
              className={
                s.status === 'failed' ? 'ue:min-w-0 ue:truncate ue:text-danger' : 'ue:min-w-0 ue:truncate ue:text-fg'
              }
            >
              {s.message}
            </span>
            <span className="ue:ml-auto ue:shrink-0 ue:tabular-nums ue:text-subtle">{ms(s.durationMs)}</span>
          </div>
        ))}
    </div>
  )
}
