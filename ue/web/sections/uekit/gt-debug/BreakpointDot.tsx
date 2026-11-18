import { h, t } from '../../../host.ts'
import { toggleBreakpoint, useHasBreakpoint } from './breakpoints.ts'

/**
 * 断点标记：流程图节点左上角、列表行最左边的红点（像代码编辑器的断点）。没断点不占位；点一下取消。
 * inline：列表行里排在行内，不浮在角上
 */
export function BreakpointDot({ k, inline }: { k?: string; inline?: boolean }) {
  const on = useHasBreakpoint(k)
  if (!on || !k) return null
  return (
    <button
      type="button"
      title={t('断点：跑到这里先停下（点一下取消，F9 切换）')}
      aria-label={t('取消断点')}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        toggleBreakpoint(k)
      }}
      className={h().cn(
        'ue:h-2.5 ue:w-2.5 ue:shrink-0 ue:cursor-pointer ue:rounded-full ue:bg-danger ue:ring-2 ue:ring-bg',
        !inline && 'ue:absolute ue:-top-1 ue:-left-1 ue:z-10',
      )}
    />
  )
}
