import { h } from '../../host.ts'
import { stateMeta } from './kinds.ts'

/**
 * 同步状态徽标（设计稿 §4 共用组件）：点 + 文案，颜色只走 stateMeta 的主题色。
 * 树行右侧、右栏头部、多选摘要、作业报告都用这一个，状态色改一处全跟着变。
 * count 给了就在文案前加数字（多选摘要里「2 配置已改」）；soft 时加一层淡底，当头部徽标用。
 */
export function StatePill({ state, count, soft }: { state: string; count?: number; soft?: boolean }) {
  const { cn } = h()
  const s = stateMeta(state)
  return (
    <span
      className={cn(
        'ue:inline-flex ue:h-5 ue:shrink-0 ue:items-center ue:gap-1.5 ue:rounded-sm ue:text-caption ue:font-medium ue:whitespace-nowrap',
        soft && 'ue:bg-hover ue:px-1.5',
        s.tone,
      )}
    >
      <span className={cn('ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full', s.dot)} />
      {count !== undefined && <span className="ue:tabular-nums">{count}</span>}
      {s.label()}
    </span>
  )
}
