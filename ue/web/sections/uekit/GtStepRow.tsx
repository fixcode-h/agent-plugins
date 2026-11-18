import {
  Camera,
  CheckSquare,
  Clock,
  Footprints,
  Keyboard,
  type LucideIcon,
  MousePointer2,
  MousePointerClick,
  Move,
  Play,
  ScrollText,
  SkipForward,
  Square,
  Terminal,
  TriangleAlert,
  Type,
  Zap,
} from 'lucide-react'
import { h, t } from '../../host.ts'
import { CheckMark, ms, StepIcon, type StepRow } from './GtStepDetail.tsx'
import { ambiguousOf } from './gt-steps.ts'
import { keyOf } from './gt-key.ts'
import { stepTitle } from './gt-step-title.ts'
import { skipLabel, skipOf, skipWith } from './gt-skip.ts'

/** 动作 → 行首的小图标：一眼分出点击、等待、按键，不用读动作名 */
export function actionIcon(a?: string): LucideIcon {
  switch (a) {
    case 'click':
    case 'select':
      return MousePointerClick
    case 'drag':
    case 'scroll':
    case 'wheel':
      return Move
    case 'input.cursor':
      return MousePointer2
    case 'key':
    case 'ability.input':
    case 'input.start':
    case 'input.stop':
      return Keyboard
    case 'type':
      return Type
    case 'wait':
    case 'editor.ensure':
      return Clock
    case 'assert':
    case 'probe':
    case 'net.compare':
      return CheckSquare
    case 'screenshot':
    case 'snapshot':
      return Camera
    case 'pie.start':
    case 'level.load':
      return Play
    case 'pie.stop':
      return Square
    case 'console':
      return Terminal
    case 'mark':
      return ScrollText
    case 'move':
      return Footprints
    default:
      return Zap
  }
}

/**
 * GameTest 步骤列表的一行：序号、状态、动作图标、一句中文（stepTitle），右边是耗时。
 * 选择器、hint、参数、结果消息都不在行里，选中后在右边详情看；只留两个要马上看到的标记：
 * 选择器可能不唯一（黄三角）、「核对选择器」的结果（准星 / 红三角）、条目怎么认待定（黄字，GameTest 1.4.0）
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
  const Icon = actionIcon(action)
  const title = stepTitle(row.def, row.res?.action, row.res?.target)
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
      className={cn(
        'ue:grid ue:h-9 ue:w-full ue:cursor-pointer ue:grid-cols-[24px_16px_14px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-4 ue:text-left ue:transition-colors ue:hover:bg-sel/50 ue:aria-selected:bg-sel',
        status === 'failed' && 'ue:bg-danger/6',
        (dim || status === 'already') && 'ue:opacity-60',
      )}
    >
      <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">{row.i + 1}</span>
      <StepIcon s={status} live={live} />
      <Icon className="ue:h-3.5 ue:w-3.5 ue:text-subtle" aria-label={action} />
      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
        <span
          className={cn('ue:min-w-0 ue:truncate ue:text-body', status === 'failed' ? 'ue:text-danger' : 'ue:text-fg')}
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
            {along !== undefined ? t('随第 {n} 步', { n: along + 1 }) : t('已达成')}
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
