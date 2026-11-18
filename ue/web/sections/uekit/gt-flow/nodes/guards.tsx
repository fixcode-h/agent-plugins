import { memo } from 'react'
import { ArrowRight, Plus, ShieldCheck } from 'lucide-react'
import { CountBadge } from '@panel/web/src/components/ui/count-badge'
import { h, t } from '../../../../host.ts'
import { useFlow } from '../ctx.ts'
import { guardFace } from '../faces.tsx'
import { guardTotal } from '../run-state.ts'
import type { FlowNodeProps } from './parts.tsx'

const SCOPE: Record<string, string> = {
  global: 'ue:bg-sel ue:text-muted',
  script: 'ue:bg-accent-soft ue:text-accent-text',
  block: 'ue:bg-run-soft ue:text-run',
}
const scopeLabel = (s?: string) => (s === 'global' ? t('全局') : s === 'block' ? t('块内') : t('本脚本'))

/**
 * 守护栏（定稿 7、9.1）：主流程下方一个框，守护竖着排成一列，表示同时盯着；
 * 标题上写这次运行一共触发了几次，底部是「加守护」和来源说明
 */
export const RailNode = memo(function RailNode() {
  const { run, editable, addGuard } = useFlow()
  const total = guardTotal(run)
  return (
    <div className="ue:relative ue:flex ue:h-full ue:w-full ue:flex-col ue:rounded-2xl ue:bg-[color-mix(in_oklab,var(--color-success)_5%,transparent)] ue:ring-1 ue:ring-success/35">
      <div className="ue:flex ue:h-[34px] ue:items-center ue:gap-1.5 ue:px-3 ue:text-caption ue:text-muted">
        <ShieldCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
        <span className="ue:font-medium ue:text-fg">{t('同步 · 守护')}</span>
        <span className="ue:truncate ue:text-subtle">{t('同时盯着 · 每一步之前、等待中每 0.2 秒看一次')}</span>
        {total > 0 && (
          <span className="ue:ml-auto ue:shrink-0 ue:font-medium ue:text-success">
            {t('触发 {n} 次', { n: total > 999 ? '999+' : total })}
          </span>
        )}
      </div>
      <div className="ue:mt-auto ue:flex ue:h-[44px] ue:items-center ue:gap-2 ue:px-3 ue:text-caption ue:text-subtle">
        {editable && addGuard && (
          <button
            type="button"
            className="nodrag ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-lg ue:px-2 ue:text-success ue:hover:bg-hover"
            onClick={(e) => {
              e.stopPropagation()
              addGuard()
            }}
          >
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('加守护')}
          </button>
        )}
        <span className="ue:truncate">{t('同时成立时按从上到下的先后处理')}</span>
      </div>
    </div>
  )
})

/** 一条守护：当 … → 做 …；右上角圆底角标是这次运行触发了几次（没触发不显示，超过 999 写 999+） */
export const GuardNode = memo(function GuardNode({ data }: FlowNodeProps) {
  const n = data.node
  const { run, selected } = useFlow()
  const g = n.guard ?? {}
  const f = guardFace(g)
  const count = n.key ? (run.guards[n.key] ?? 0) : 0
  const active = !!n.key && run.guardActive === n.key
  const sel = n.path ? selected === `guard:${n.path.join('.')}` : false
  return (
    <div
      className={h().cn(
        'ue:relative ue:grid ue:h-full ue:w-full ue:grid-cols-[1fr_auto_1fr] ue:items-center ue:gap-2 ue:rounded-xl ue:bg-card ue:px-3 ue:shadow-card',
        active && 'node-running ue:ring-1 ue:ring-run/60',
        sel && 'ue:ring-2 ue:ring-accent',
        g.disabled === true && 'ue:opacity-50',
      )}
    >
      <div className="ue:min-w-0">
        <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-body">
          <span className={h().cn('ue:shrink-0 ue:rounded ue:px-1 ue:text-micro', SCOPE[n.scope ?? 'script'])}>
            {scopeLabel(n.scope)}
          </span>
          <span className="ue:truncate ue:font-medium">{t('当 {w}', { w: f.when })}</span>
        </div>
        {f.whenSub && <div className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{f.whenSub}</div>}
      </div>
      <ArrowRight className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
      <div className="ue:min-w-0">
        <div className="ue:truncate ue:text-body">{f.act}</div>
        {f.actSub && <div className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{f.actSub}</div>}
      </div>
      <CountBadge corner count={count} />
    </div>
  )
})
