import { memo } from 'react'
import { CountBadge } from '@panel/web/src/components/ui/count-badge'
import { h, t } from '../../../../host.ts'
import { BreakpointDot } from '../../gt-debug/BreakpointDot.tsx'
import { useFlow } from '../ctx.ts'
import { faceOf } from '../faces.tsx'
import { Handles, RUN_LOOK, Sub, type FlowNodeProps } from './parts.tsx'

/** 运行结果的耗时：一秒内写毫秒 */
const msText = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

/**
 * 一步（叶子动作）、如果的判断节点、折叠起来的块，都画成这张卡片：图标 + 一句话，下面一行细节。
 * 选中描主题色；运行中按状态染底；折叠的块写「N 步」，双击展开
 */
export const StepNode = memo(function StepNode({ data }: FlowNodeProps) {
  const n = data.node
  const { run, selected } = useFlow()
  const step = n.step
  if (!step) return null
  const face = faceOf(step)
  const st = n.key ? run.steps[n.key] : undefined
  const Icon = face.icon
  const disabled = step.disabled === true
  return (
    <div
      data-gt-node={n.key}
      className={h().cn(
        'ue:relative ue:flex ue:h-full ue:w-full ue:flex-col ue:justify-center ue:gap-0.5 ue:rounded-xl ue:bg-card ue:px-3 ue:shadow-card',
        st && RUN_LOOK[st.status],
        selected === n.key && 'ue:ring-2 ue:ring-accent',
        // 停在断点 / 单步停在这一步：描暂停色，和正在跑的区分开
        run.paused && run.at === n.key && 'ue:ring-2 ue:ring-warning',
        disabled && 'ue:opacity-50',
      )}
    >
      <Handles node={n} />
      <BreakpointDot k={n.key} />
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-body">
        <Icon className={h().cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', face.tone)} />
        <span
          className={h().cn('ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium', disabled && 'ue:line-through')}
          title={face.title}
        >
          {face.title}
        </span>
        {n.hidden !== undefined && (
          <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('{n} 步', { n: n.hidden })}</span>
        )}
        {st?.ms !== undefined && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{msText(st.ms)}</span>}
      </div>
      <Sub>{n.hidden !== undefined ? t('双击展开') : face.sub}</Sub>
      <CountBadge corner count={st?.runs ?? 0} />
    </div>
  )
})
