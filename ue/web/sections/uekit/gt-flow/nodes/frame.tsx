import { memo } from 'react'
import { CountBadge } from '@panel/web/src/components/ui/count-badge'
import { ChevronsDownUp } from 'lucide-react'
import { h, t } from '../../../../host.ts'
import { BreakpointDot } from '../../gt-debug/BreakpointDot.tsx'
import { useFlow } from '../ctx.ts'
import { faceOf } from '../faces.tsx'
import type { FrameTone } from '../looks.ts'
import { Handles, RUN_LOOK, type FlowNodeProps } from './parts.tsx'

/** 框的色调（looks.ts）：底色很淡，只是把一块圈出来；循环青、分支琥珀，和效果图一致 */
const TONE: Record<FrameTone, string> = {
  group: 'ue:bg-[color-mix(in_oklab,var(--color-fg)_3%,transparent)] ue:ring-line',
  loop: 'ue:bg-[color-mix(in_oklab,var(--color-run)_5%,transparent)] ue:ring-run/35',
  branch: 'ue:bg-[color-mix(in_oklab,var(--color-warning)_5%,transparent)] ue:ring-warning/35',
  call: 'ue:bg-[color-mix(in_oklab,var(--color-accent)_4%,transparent)] ue:ring-accent/30',
}

/**
 * 一个槽的块（步骤段、循环）、前置步骤：一个框，标题栏写块的名字；循环运行中写「第 N 轮」。
 * 框画在子节点下面（zIndex 低），选中、点标题栏选的是这块；标题栏右边能折叠
 */
export const FrameNode = memo(function FrameNode({ data }: FlowNodeProps) {
  const n = data.node
  const { run, selected, toggle } = useFlow()
  const face = n.step ? faceOf(n.step) : undefined
  const st = n.key ? run.steps[n.key] : undefined
  const Icon = face?.icon
  return (
    <div
      data-gt-node={n.key}
      className={h().cn(
        'ue:relative ue:h-full ue:w-full ue:rounded-2xl ue:ring-1',
        TONE[n.tone ?? 'group'],
        st?.status === 'running' && 'ue:ring-run/70',
        st && st.status !== 'running' && RUN_LOOK[st.status],
        selected === n.key && n.key && 'ue:ring-2 ue:ring-accent',
      )}
    >
      <Handles node={n} />
      <BreakpointDot k={n.key} />
      <div className="ue:flex ue:h-[30px] ue:items-center ue:gap-1.5 ue:px-3 ue:text-caption ue:text-muted">
        {Icon && <Icon className={h().cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', face?.tone)} />}
        <span className="ue:truncate ue:font-medium ue:text-fg">
          {n.role === 'setup' ? t('前置步骤') : face?.title}
        </span>
        {face?.sub && <span className="ue:truncate ue:text-subtle">{face.sub}</span>}
        {st?.iter !== undefined && (
          <span className="ue:shrink-0 ue:rounded-full ue:bg-run-soft ue:px-1.5 ue:text-run">
            {t('第 {n} 轮', { n: st.iter })}
          </span>
        )}
        {n.key && (
          <button
            type="button"
            className="nodrag ue:ml-auto ue:flex ue:h-5 ue:w-5 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded ue:text-subtle ue:hover:bg-hover ue:hover:text-fg"
            aria-label={t('折叠')}
            title={t('折叠成一个节点')}
            onClick={(e) => {
              e.stopPropagation()
              toggle(n.key!)
            }}
          >
            <ChevronsDownUp className="ue:h-3.5 ue:w-3.5" />
          </button>
        )}
      </div>
      <CountBadge corner count={st?.runs ?? 0} />
    </div>
  )
})
