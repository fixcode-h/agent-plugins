import type { MouseEvent } from 'react'
import { h } from '../host.ts'
import { lineCount } from './layout.ts'

/** 级别对应的文字颜色（终端配色），错误、警告和普通 */
export const logTone = (v: string) =>
  /Error|Fatal/.test(v) ? 'ue:text-danger' : v === 'Warning' ? 'ue:text-warning' : 'ue:text-term-fg'

export interface LogEntryRowProps {
  /** 第一行左边显示的时间（已经格式化好；没有就留空，不拿收到的时间顶替） */
  time: string
  category: string
  verbosity: string
  /** 多行记录的各行用 \n 连起来；续行和第一行对齐，不再重复时间和分类 */
  text: string
  /** 连续重复折叠的次数，>1 时右边显示 ×N */
  count?: number
  selected?: boolean
  top: number
  rowH: number
  onClick?: (e: MouseEvent) => void
}

/**
 * 运行日志的一条记录（共用组件）：时间、分类只在第一行出现一次，续行缩进到文字列下面接着画，
 * 整条一个背景、一次点击，选中、复制、发给对话都按整条算。高度按行数算，配合 layout.ts 的虚拟滚动。
 */
export function LogEntryRow({
  time,
  category,
  verbosity,
  text,
  count,
  selected,
  top,
  rowH,
  onClick,
}: LogEntryRowProps) {
  const { cn } = h()
  const n = lineCount(text)
  const lines = n > 1 ? text.split('\n', n) : [text]
  return (
    <div
      onClick={onClick}
      style={{ top, height: n * rowH }}
      className={cn(
        'ue:absolute ue:inset-x-0 ue:flex ue:cursor-default ue:gap-2 ue:px-4 ue:leading-5',
        logTone(verbosity),
        selected && 'ue:bg-term-hover',
      )}
    >
      <span className="ue:w-15 ue:shrink-0 ue:text-term-subtle">{time}</span>
      <span className="ue:shrink-0 ue:text-term-subtle">{category}</span>
      <div className="ue:min-w-0 ue:flex-1">
        {lines.map((l, i) => (
          <div key={i} className="ue:truncate ue:whitespace-pre" style={{ height: rowH }}>
            {l || ' '}
          </div>
        ))}
      </div>
      {!!count && count > 1 && (
        <span className="ue:h-5 ue:shrink-0 ue:self-start ue:rounded ue:bg-term-hover ue:px-1.5 ue:text-caption ue:text-term-fg">
          ×{count}
        </span>
      )}
    </div>
  )
}
