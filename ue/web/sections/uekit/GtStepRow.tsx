import { SkipForward, TriangleAlert } from 'lucide-react'
import { h, t } from '../../host.ts'
import { CheckMark, ms, StepIcon, type StepRow } from './GtStepDetail.tsx'
import { ambiguousOf } from './gt-steps.ts'
import { keyOf } from './gt-key.ts'
import { stepTitle } from './gt-step-title.ts'
import { actionIcon } from './gt-action-icon.ts'
import { skipLabel, skipOf, skipWith } from './gt-skip.ts'
import { faceOf } from './gt-flow/faces.tsx'
import { numOf } from './gt-rows/rows.ts'
import type { GtStep } from '../../../shared/gt-script/index.ts'

/**
 * GameTest 步骤列表的一行：序号、状态、动作图标、一句中文（stepTitle），右边是耗时。
 * 选择器、hint、参数、结果消息都不在行里，选中后在右边详情看；只留两个要马上看到的标记：
 * 选择器可能不唯一（黄三角）、「核对选择器」的结果（准星 / 红三角）、条目怎么认待定（黄字，GameTest 1.4.0）。
 * 录制段、如果、循环里的步骤按层缩进，序号带上外层（2.3）；块那一行用流程图同一套的图标和名字（录制段、如果……）
 */
export function GtStepRow({
  row,
  selected,
  live,
  dim,
  onClick,
  onContextMenu,
}: {
  row: StepRow
  selected?: boolean
  /** 正在跑的这一步 */
  live?: boolean
  /** 运行中或跑过之后还没轮到的步骤，淡一点 */
  dim?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const { cn } = h()
  const action = row.def?.action || row.res?.action
  const face = row.block && row.def ? faceOf(row.def as GtStep) : undefined
  const Icon = face?.icon ?? actionIcon(action)
  const title = face?.title ?? stepTitle(row.def, row.res?.action, row.res?.target)
  const ambiguous = ambiguousOf(row.def)
  // 录制时点在列表条目上、没定下用哪个字段认（GameTest 1.4.0）：标「待定」，详情里「回放怎么认」再定
  const pending = keyOf(row.def?.hint as Record<string, unknown> | undefined)?.by === 'pending'
  const status = row.res?.status
  // 已达成就跳过（GameTest 1.7.0）：跑完是 already 时写「已达成」/「随第 N 步」，没跑时写条件的一句话
  const skip = skipOf(row.def)
  const along = status === 'already' ? skipWith(row.res?.payload) : undefined
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-selected={selected}
      title={title}
      // 块里的步骤按层缩进（一层 14px），块行的背景淡一点，看得出段从哪儿开始
      style={row.depth ? { paddingLeft: 16 + row.depth * 14 } : undefined}
      className={cn(
        'ue:grid ue:h-9 ue:w-full ue:cursor-pointer ue:grid-cols-[minmax(24px,auto)_16px_14px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4 ue:text-left ue:transition-colors ue:hover:bg-sel/50 ue:aria-selected:bg-sel',
        row.block && 'ue:bg-sel/25',
        status === 'failed' && 'ue:bg-danger/6',
        (dim || status === 'already') && 'ue:opacity-60',
      )}
    >
      <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">{row.no}</span>
      <StepIcon s={status} live={live} />
      <Icon className="ue:h-3.5 ue:w-3.5 ue:text-subtle" aria-label={action} />
      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
        <span
          className={cn(
            'ue:min-w-0 ue:truncate ue:text-body',
            row.block && 'ue:font-medium',
            status === 'failed' ? 'ue:text-danger' : 'ue:text-fg',
          )}
        >
          {title}
        </span>
        {ambiguous && (
          <span title={t('选择器可能不唯一：{r}', { r: ambiguous })} className="ue:shrink-0">
            <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:text-warning" />
          </span>
        )}
        {pending && (
          <span
            title={t('这一格怎么认还没定：选中后在「回放怎么认」里挑')}
            className="ue:shrink-0 ue:text-caption ue:text-warning"
          >
            {t('待定')}
          </span>
        )}
        {status === 'already' ? (
          <span className="ue:shrink-0 ue:text-caption ue:text-success">
            {along !== undefined ? t('随第 {n} 步', { n: numOf(row)(along) }) : t('已达成')}
          </span>
        ) : (
          skip && (
            <span
              title={t('回放时{s}', { s: skipLabel(skip) })}
              className="ue:flex ue:min-w-0 ue:shrink ue:items-center ue:gap-0.5 ue:text-caption ue:text-subtle"
            >
              <SkipForward className="ue:h-3 ue:w-3 ue:shrink-0" />
              <span className="ue:truncate">{skipLabel(skip)}</span>
            </span>
          )
        )}
        <CheckMark check={row.check} />
      </span>
      <span className="ue:text-caption ue:text-subtle ue:tabular-nums">{ms(row.res?.durationMs)}</span>
    </button>
  )
}
