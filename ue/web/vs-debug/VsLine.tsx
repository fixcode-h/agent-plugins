import { Bug, Loader2 } from 'lucide-react'
import { useUe } from '../ctx.tsx'
import { t } from '../host.ts'
import { Dot } from '../ui.tsx'
import { frameAt, phaseLine, phaseOf } from './model.ts'

/**
 * 左栏目标卡底部的一行「VS：停在断点 · Foo.cpp:12」：在调试、编译、启动时才出现，哪一页都看得见，点一下去概览的 VS 调试卡片。
 * UE 停在断点时整个进程冻住，目标卡会显示「编辑器忙」，这一行说明是被调试器停住了，不是卡死
 */
export function VsLine() {
  const { state, go } = useUe()
  const vs = state?.vsDebug
  const phase = phaseOf(vs)
  if (phase === 'off' || phase === 'design') return null
  const line = phaseLine(vs)
  const at = phase === 'break' ? frameAt(vs?.status?.location) : ''
  return (
    <button
      type="button"
      onClick={() => go('overview')}
      title={t('到概览看 VS 调试')}
      className="ue:flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:border-t ue:border-line ue:pt-1.5 ue:text-left ue:text-caption ue:text-subtle ue:hover:text-fg"
    >
      {phase === 'building' || phase === 'launching' ? (
        <Loader2 className="ue:h-3 ue:w-3 ue:shrink-0 ue:animate-spin" />
      ) : (
        <Dot tone={line.tone} />
      )}
      <Bug className="ue:h-3 ue:w-3 ue:shrink-0" />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate">{at ? `VS · ${line.text} · ${at}` : `VS · ${line.text}`}</span>
    </button>
  )
}
