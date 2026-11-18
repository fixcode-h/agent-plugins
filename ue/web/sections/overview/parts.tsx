import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { h } from '../../host.ts'

/**
 * 概览页的小部件（设计稿 designs/UE插件优化与扩展-设计稿.md 三.1，效果图 1）：读数块、「需要你处理」的一行、
 * 时间线的一行。只用面板主题变量；设置 →「组件」里有示例（overview/Specimen.tsx）
 */

export type AttnTone = 'danger' | 'warn' | 'accent' | 'muted'

const ICON_TONES: Record<AttnTone, string> = {
  danger: 'ue:bg-danger/10 ue:text-danger',
  warn: 'ue:bg-warning/12 ue:text-warning',
  accent: 'ue:bg-accent-soft ue:text-accent-text',
  muted: 'ue:bg-hover ue:text-muted',
}

const NUM_TONES: Record<AttnTone, string> = {
  danger: 'ue:text-danger',
  warn: 'ue:text-warning',
  accent: 'ue:text-accent-text',
  muted: 'ue:text-fg',
}

/** 四个读数之一：标题、大号数字（tabular-nums，有问题变色）、一句说明；给了 onClick 就能点进对应分区 */
export function Readout({
  icon: Icon,
  title,
  value,
  unit,
  desc,
  tone = 'muted',
  onClick,
}: {
  icon: LucideIcon
  title: string
  value: ReactNode
  unit?: ReactNode
  desc?: ReactNode
  tone?: AttnTone
  onClick?: () => void
}) {
  const { cn } = h()
  const body = (
    <>
      <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:text-subtle">
        <Icon className="ue:h-3.5 ue:w-3.5" /> {title}
      </div>
      <div className="ue:flex ue:min-w-0 ue:items-baseline ue:gap-2">
        <span className={cn('ue:text-title ue:font-medium ue:tabular-nums', NUM_TONES[tone])}>{value}</span>
        {unit && <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-muted">{unit}</span>}
      </div>
      {/* 说明行总占位：取样中、UE 开关这类说明时有时无，不占位的话四个读数一起变高变矮，整页跟着跳 */}
      <div className="ue:truncate ue:text-caption ue:text-subtle">{desc || '\u00a0'}</div>
    </>
  )
  const cls = 'ue:flex ue:min-w-0 ue:flex-col ue:gap-1.5 ue:bg-card ue:p-4 ue:text-left'
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, 'ue:cursor-pointer ue:transition-colors ue:hover:bg-hover')}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export interface AttnAction {
  label: string
  icon?: LucideIcon
  primary?: boolean
  run: () => void
}

export interface AttnItem {
  key: string
  tone: AttnTone
  icon: LucideIcon
  title: string
  detail?: string
  actions: AttnAction[]
}

/** 「需要你处理」的一行：带色的图标、标题、一行灰字（等宽，常是报错原文）、行尾的主动作 */
export function AttentionRow({ item, disabled }: { item: AttnItem; disabled?: boolean }) {
  const { ui, cn } = h()
  return (
    <li className="ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-2.5">
      <span
        className={cn(
          'ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg',
          ICON_TONES[item.tone],
        )}
      >
        <item.icon className="ue:h-4 ue:w-4" />
      </span>
      <div className="ue:min-w-0 ue:flex-1">
        <div className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{item.title}</div>
        {item.detail && (
          <div className="ue:truncate ue:font-mono ue:text-footnote ue:text-subtle" title={item.detail}>
            {item.detail}
          </div>
        )}
      </div>
      <div className="ue:flex ue:shrink-0 ue:flex-wrap ue:justify-end ue:gap-1.5">
        {item.actions.map((a) => (
          <ui.Button
            key={a.label}
            size="sm"
            variant={a.primary ? 'primary' : 'secondary'}
            disabled={disabled}
            onClick={a.run}
          >
            {a.icon && <a.icon className="ue:h-3.5 ue:w-3.5" />} {a.label}
          </ui.Button>
        ))}
      </div>
    </li>
  )
}

/** 时间线的一行：时间、带色的标签、一句话；能点的跳到对应分区，行尾可以放一个小动作（撤回） */
export function TimelineRow({
  time,
  tag,
  tone,
  text,
  sub,
  onClick,
  aside,
}: {
  time: string
  tag: string
  tone: AttnTone | 'ok'
  text: string
  sub?: string
  onClick?: () => void
  aside?: ReactNode
}) {
  const { cn } = h()
  const tagCls =
    tone === 'ok'
      ? 'ue:bg-success/12 ue:text-success'
      : tone === 'muted'
        ? 'ue:bg-hover ue:text-muted'
        : ICON_TONES[tone]
  return (
    <li className="ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-2 ue:hover:bg-hover">
      <span className="ue:w-16 ue:shrink-0 ue:font-mono ue:text-footnote ue:text-subtle ue:tabular-nums">{time}</span>
      <span
        className={cn(
          'ue:inline-flex ue:h-5 ue:shrink-0 ue:items-center ue:rounded-sm ue:px-1.5 ue:text-caption ue:font-medium',
          tagCls,
        )}
      >
        {tag}
      </span>
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className="ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:text-left ue:disabled:cursor-default"
      >
        <div className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={text}>
          {text}
        </div>
        {sub && <div className="ue:truncate ue:text-footnote ue:text-danger">{sub}</div>}
      </button>
      {aside}
    </li>
  )
}
