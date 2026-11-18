import { Plus } from 'lucide-react'
import type { GtGuard, GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { GuardList } from './GuardList.tsx'
import { blankGuard } from './model.ts'

/**
 * 块上的守护（定稿 7.3「某一块」）：只在跑这一块时生效，和脚本、全局的叠加（例如战斗段里的复活弹窗）。
 * 检查器公共字段里、块才有；和「这个脚本的守护」同一个列表组件
 */
export function BlockGuards({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const guards = (Array.isArray(step.guards) ? step.guards : []) as GtGuard[]
  const set = (v: GtGuard[]) => {
    const next = { ...step }
    if (v.length) next.guards = v
    else delete next.guards
    onChange(next)
  }
  return (
    <section className="ue:flex ue:flex-col ue:gap-1.5">
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('这一块的守护')}</span>
        <ui.Button
          size="sm"
          variant="ghost"
          className="ue:ml-auto"
          onClick={() => set([...guards, blankGuard(new Set(guards.map((g) => g.id ?? '')))])}
        >
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('添加')}
        </ui.Button>
      </div>
      <p className="ue:text-caption ue:text-subtle">
        {t('只在跑这一块时盯着，和脚本、全局的守护一起生效；出了这一块就不管')}
      </p>
      {guards.length > 0 && <GuardList value={guards} onChange={set} />}
    </section>
  )
}
