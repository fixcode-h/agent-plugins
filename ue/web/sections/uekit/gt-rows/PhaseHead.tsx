import type { ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  CircleX,
  ClipboardList,
  Eraser,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { h, t } from '../../../host.ts'
import { PHASE_TITLE, type PhaseKey, type PhaseState } from './phases.ts'

/**
 * 三段的名字、说明、图标和颜色：编辑页列表、流程图事件节点、对话卡片、报告都从这里取，改一处全跟着变。
 * 颜色名是面板主题变量（var(--proj-ico) 蓝、success 绿、warning 琥珀）
 */
export const PHASE_META: Record<
  PhaseKey,
  { title: () => string; hint: () => string; add: () => string; icon: LucideIcon; tone: string }
> = {
  setup: {
    title: PHASE_TITLE.setup,
    hint: () => t('把环境准备好、确认前置条件都在；这里失败算「前置不满足」，不算测试失败'),
    add: () => t('加执行前步骤'),
    icon: ClipboardList,
    tone: 'proj-ico',
  },
  steps: {
    title: PHASE_TITLE.steps,
    hint: () => t('按正常游戏流程操作并检查结果，决定这次通过还是失败'),
    add: () => t('加一步'),
    icon: CirclePlay,
    tone: 'success',
  },
  teardown: {
    title: PHASE_TITLE.teardown,
    hint: () => t('跑完、失败、前置不满足、按停止后都会做；这里失败只记警告'),
    add: () => t('加执行后步骤'),
    icon: Eraser,
    tone: 'warning',
  },
}

/** 段的小图标块（列表小节头、流程图事件节点） */
export function PhaseTile({ phase, size = 20 }: { phase: PhaseKey; size?: number }) {
  const m = PHASE_META[phase]
  const Icon = m.icon
  return (
    <span
      className="ue:grid ue:shrink-0 ue:place-items-center ue:rounded-md"
      style={{
        width: size,
        height: size,
        color: `var(--${m.tone})`,
        background: `color-mix(in oklab, var(--${m.tone}) 14%, transparent)`,
      }}
    >
      <Icon style={{ width: size * 0.62, height: size * 0.62 }} />
    </span>
  )
}

/** 段跑得怎样的图标 */
export function PhaseStateIcon({ state }: { state: PhaseState }) {
  const c = 'ue:h-3.5 ue:w-3.5 ue:shrink-0'
  if (state === 'running') return <Loader2 className={`${c} ue:animate-spin ue:text-run`} />
  if (state === 'passed') return <CircleCheck className={`${c} ue:text-success`} />
  if (state === 'failed') return <CircleX className={`${c} ue:text-danger`} />
  if (state === 'blocked') return <CircleAlert className={`${c} ue:text-warning`} />
  if (state === 'warned') return <TriangleAlert className={`${c} ue:text-warning`} />
  return <CircleDashed className={`${c} ue:text-subtle`} />
}

/** 一段跑完后折起来时那一行的摘要 */
export function phaseSummary(state: PhaseState, done: number, total?: number) {
  // 跑着的段说「正在第几步」（和卡片标题的「执行 第 n/m 步」一致），其余说做了几步
  const at = state === 'running' ? done + 1 : done
  const of = total !== undefined ? `${Math.min(at, total)}/${total}` : String(at)
  switch (state) {
    case 'empty':
      return t('没有步骤，跳过')
    case 'running':
      return t('第 {n} 步', { n: of })
    case 'pending':
      return total ? t('{n} 步 · 等待', { n: total }) : t('等待')
    case 'skipped':
      return total || done ? t('{n} 步没跑', { n: total || done }) : t('没跑')
    case 'blocked':
      return t('前置不满足')
    case 'failed':
      return t('有步骤失败')
    case 'warned':
      return t('{n} 步完成，有警告', { n: done })
    default:
      return t('{n} 步全部通过', { n: done })
  }
}

/** 段标题行：折叠箭头、状态、段名、摘要、右侧附加（耗时） */
export function PhaseRow({
  phase,
  state,
  summary,
  open,
  onToggle,
  right,
}: {
  phase: PhaseKey
  state: PhaseState
  summary: string
  open?: boolean
  onToggle?: () => void
  right?: ReactNode
}) {
  const { cn } = h()
  const Chev = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      data-gt-phase={phase}
      data-gt-phase-state={state}
      aria-expanded={onToggle ? !!open : undefined}
      disabled={!onToggle}
      onClick={onToggle}
      className={cn(
        'ue:flex ue:w-full ue:min-w-0 ue:items-center ue:gap-2 ue:py-1 ue:text-left',
        onToggle && 'ue:cursor-pointer',
      )}
    >
      <Chev className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle', !onToggle && 'ue:invisible')} />
      <PhaseStateIcon state={state} />
      <span
        className={cn(
          'ue:shrink-0 ue:font-medium',
          state === 'empty' || state === 'skipped' ? 'ue:text-subtle' : 'ue:text-fg',
        )}
      >
        {PHASE_META[phase].title()}
      </span>
      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-subtle">{summary}</span>
      {right}
    </button>
  )
}

/** 编辑页列表里一段的小节头：图标、段名、步数、这段放什么（三段常驻，空的也有头） */
export function PhaseSectionHead({ phase, count, extra }: { phase: PhaseKey; count: number; extra?: ReactNode }) {
  const m = PHASE_META[phase]
  return (
    <div className="ue:sticky ue:top-0 ue:z-10 ue:flex ue:h-8 ue:min-w-0 ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:bg-panel ue:px-3 ue:text-caption">
      <PhaseTile phase={phase} size={18} />
      <span className="ue:shrink-0 ue:font-medium ue:text-fg">{m.title()}</span>
      <span className="ue:shrink-0 ue:text-subtle ue:tabular-nums">{count}</span>
      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-subtle" title={m.hint()}>
        {m.hint()}
      </span>
      {extra}
    </div>
  )
}
