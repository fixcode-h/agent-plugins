import { Map as MapIcon, Play } from 'lucide-react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { stepTitle } from '../gt-step-title.ts'
import { LeafInspector } from './leaf.tsx'
import { MapField } from './fields/suggest-fields.tsx'
import { Row } from './parts.tsx'
import { registerApiUi, registerBlockUi, type InsertItem } from './registry.ts'

/**
 * 打开地图（设计稿「GameTest常用UE工具与卡住断开区分」3.2）：一个节点三种方式，检查器里切——
 * 编辑器里打开（level.load，PIE 之前换起始地图）/ 用这张图开 PIE（pie.start map）/
 * 游戏里切图（PIE 或游戏进程里，调接口 World.Open，GameTest 等到新地图加载完）。
 * 切方式只换动作、保留地图，其余字段按各自的动作表（fields/actions.ts）出
 */
type Mode = 'level.load' | 'pie.start' | 'game'
const GAME_API = 'World.Open'

const modeOf = (s: GtStep): Mode =>
  s.action === 'pie.start' ? 'pie.start' : s.action === 'api' ? 'game' : 'level.load'

const argsOf = (s: GtStep) => (s.args && typeof s.args === 'object' ? (s.args as Record<string, unknown>) : {})
const mapOf = (s: GtStep) => String((modeOf(s) === 'game' ? argsOf(s).map : s.map) ?? '')

function MapOpenInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const cur = modeOf(step)
  const swap = (m: string) => {
    if (m === cur) return
    // 只带地图和公共字段过去：PIE 的窗口、网络这些字段 level.load 不认，留着会报未知字段
    const next: GtStep = m === 'game' ? { action: 'api', api: GAME_API, args: { map: mapOf(step) } } : { action: m }
    for (const k of ['id', 'title', 'note', 'onFail', 'retries', 'timeoutMs', 'skipIf', 'disabled'])
      if (step[k] !== undefined) next[k] = step[k]
    if (m !== 'game' && mapOf(step)) next.map = mapOf(step)
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
          { id: 'level.load', label: t('编辑器里打开') },
          { id: 'pie.start', label: t('用这张图开 PIE') },
          { id: 'game', label: t('游戏里切图') },
        ]}
      />
      {cur === 'game' ? (
        <>
          <Row label={t('地图')}>
            <MapField value={mapOf(step)} onChange={(v) => onChange({ ...step, args: { ...argsOf(step), map: v } })} />
          </Row>
          <p className="ue:text-footnote ue:text-subtle">
            {t(
              '在正在玩的游戏里（PIE 或游戏进程）切到这张图，等新地图加载完再往下走；要按真实玩家操作进关卡时，改用点击按钮再等地图',
            )}
          </p>
        </>
      ) : (
        <LeafInspector step={step} onChange={onChange} />
      )}
    </div>
  )
}

registerApiUi(GAME_API, {
  // 和列表、流程图节点同一句（gt-step-title.ts 的 api World.Open）
  summary: (s) => stepTitle(s),
  Inspector: MapOpenInspector,
})

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
      () => t('在编辑器里打开一张地图、用它开 PIE，或在游戏里切过去'),
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
