import { CircleDot, Pause, Play, StepForward, ArrowDownToLine } from 'lucide-react'
import { useEffect } from 'react'
import { h, t } from '../../../host.ts'
import { setBreakpoints } from './breakpoints.ts'
import type { DebugApi } from './use-debug.ts'

/**
 * 运行横条右边的调试按钮（效果图 6）：「断点 N 个」（点了全部清掉）、暂停 / 继续、单步、进块。
 * 快捷键照常见调试器：F5 继续、F6 暂停、F10 单步、F11 进块；只在跑着时生效
 */
export function RunControls({ debug }: { debug: DebugApi }) {
  const { ui } = h()
  const { flow } = debug
  const n = debug.breakpoints.length

  useEffect(() => {
    if (!flow.active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return
      const act =
        e.key === 'F5' && flow.paused
          ? debug.resume
          : e.key === 'F6' && !flow.paused
            ? debug.pause
            : e.key === 'F10' && flow.paused
              ? () => debug.step()
              : e.key === 'F11' && flow.paused
                ? () => debug.step(true)
                : undefined
      if (!act) return
      e.preventDefault()
      act()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flow.active, flow.paused, debug])

  return (
    <div className="ue:flex ue:items-center ue:gap-1.5">
      {n > 0 && (
        <ui.Button size="sm" variant="ghost" title={t('点一下清掉全部断点')} onClick={() => setBreakpoints([])}>
          <CircleDot className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
          {t('断点 {n} 个', { n })}
        </ui.Button>
      )}
      {flow.paused ? (
        <ui.Button size="sm" variant="secondary" title={t('继续（F5）')} onClick={debug.resume}>
          <Play className="ue:h-3.5 ue:w-3.5" />
          {t('继续')}
        </ui.Button>
      ) : (
        <ui.Button size="sm" variant="secondary" title={t('暂停（F6）')} disabled={!flow.active} onClick={debug.pause}>
          <Pause className="ue:h-3.5 ue:w-3.5" />
          {t('暂停')}
        </ui.Button>
      )}
      <ui.Button
        size="sm"
        variant="secondary"
        title={t('做完下一个节点再停（F10）；块算一个节点')}
        disabled={!flow.paused}
        onClick={() => debug.step()}
      >
        <StepForward className="ue:h-3.5 ue:w-3.5" />
        {t('单步')}
      </ui.Button>
      <ui.IconButton
        icon={ArrowDownToLine}
        size="sm"
        label={t('进块：停在块里的第一步（F11）')}
        disabled={!flow.paused}
        onClick={() => debug.step(true)}
      />
    </div>
  )
}
