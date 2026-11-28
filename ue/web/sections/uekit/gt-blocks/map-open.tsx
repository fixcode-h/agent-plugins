import { Map as MapIcon, Play } from 'lucide-react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { stepTitle } from '../gt-step-title.ts'
import { LeafInspector } from './leaf.tsx'
import { registerBlockUi, type InsertItem } from './registry.ts'

/**
 * 打开地图（设计稿「GameTest常用UE工具与卡住断开区分」3.2）：一个节点两种方式，检查器里切——
 * 编辑器里打开（level.load，PIE 之前换起始地图）/ 用这张图开 PIE（pie.start map）。
 * 切方式只换 action、保留地图，其余字段按各自的动作表（fields/actions.ts）出。
 * 游戏里切图（玩家点按钮进关卡）走点击 + 等新地图起来，要 GameTest 新的判断来源，二期做
 */
const MODES = ['level.load', 'pie.start'] as const

function MapOpenInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const cur = step.action === 'pie.start' ? 'pie.start' : 'level.load'
  const swap = (a: string) => {
    if (a === cur) return
    // 只带地图过去：PIE 的窗口、网络这些字段 level.load 不认，留着会报未知字段
    const next: GtStep = { action: a }
    for (const k of ['id', 'title', 'note', 'onFail', 'retries', 'timeoutMs', 'skipIf', 'disabled', 'map'])
      if (step[k] !== undefined) next[k] = step[k]
    onChange(next)
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <ui.Segmented
        size="sm"
        label={t('怎么打开')}
        value={cur}
        onChange={swap}
        options={[
          { id: MODES[0], label: t('编辑器里打开') },
          { id: MODES[1], label: t('用这张图开 PIE') },
        ]}
      />
      <LeafInspector step={step} onChange={onChange} />
    </div>
  )
}

const item = (id: string, label: () => string, hint: () => string, make: () => GtStep): InsertItem => ({
  id: `map-${id}`,
  group: () => t('地图 / PIE'),
  label,
  hint,
  slash: id,
  action: String(make().action),
  make,
})

registerBlockUi(
  {
    action: 'level.load',
    title: () => t('打开地图'),
    icon: MapIcon,
    tone: 'run',
    summary: (s) => (s.map ? stepTitle(s) : t('打开地图（还没选）')),
    Inspector: MapOpenInspector,
  },
  [
    item(
      'map',
      () => t('打开地图'),
      () => t('在编辑器里打开一张地图，或直接用它开 PIE'),
      () => ({ action: 'level.load', map: '' }),
    ),
  ],
)
registerBlockUi(
  {
    action: 'pie.start',
    title: () => t('启动 PIE'),
    icon: Play,
    tone: 'run',
    summary: (s) => stepTitle(s),
    Inspector: MapOpenInspector,
  },
  [
    item(
      'pie',
      () => t('开始 PIE'),
      () => t('在编辑器里开始玩（可选地图、窗口大小、多人）'),
      () => ({ action: 'pie.start' }),
    ),
  ],
)
