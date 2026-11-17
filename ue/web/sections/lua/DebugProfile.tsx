import { ArrowRight, Gauge } from 'lucide-react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { openPerfWithLua } from '../perf/LuaChip.tsx'

/**
 * Lua 性能的入口（Lua 性能分析设计稿 5.6b）：以前这里是 lua.profile 的平铺采样表，看不出哪一帧慢、谁调了谁；
 * 现在 Lua 函数和 UE 作用域录进同一份 trace，在性能页里一起看。这里只留一行，点了跳到性能页并把 Lua 开关打开。
 * lua.profile 的快速统计只留给 Agent（ue_lua action=profile）
 */
export function DebugProfile() {
  const { go } = useUe()
  const { ui } = h()
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-3 ue:bg-card ue:px-4 ue:py-3">
      <Gauge className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-subtle" />
      <span className="ue:min-w-0 ue:flex-1 ue:text-footnote ue:text-muted">
        {t('Lua 性能在性能页里和 UE 一起录：哪一帧慢、慢在哪个 Lua 函数、从哪个 UE 回调进来都在同一条时间轴上')}
      </span>
      <ui.Button size="sm" variant="secondary" onClick={() => openPerfWithLua(go)}>
        {t('去录制')} <ArrowRight className="ue:h-3.5 ue:w-3.5" />
      </ui.Button>
    </div>
  )
}
