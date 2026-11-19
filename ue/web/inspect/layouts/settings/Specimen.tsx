import { useState } from 'react'
import { Ctx, type UeCtx } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { AssetView } from '../../AssetView.tsx'
import { Timeline, type KeyRef } from '../../../timeline/Timeline.tsx'
import type { UeProject } from '../../../../server/types.ts'
import { LayoutSettings } from './LayoutSettings.tsx'
import { UMG_SAMPLE } from './sample.ts'

/**
 * 设置 →「组件」里的示例（用户长期规则：共用组件在设置里能看到、能跟着调节项变）。
 * 布局本身要 UE 页的上下文（项目、目标）：示例里给一个假的、没有 UE 的上下文，布局按配置走近似预览，不发请求
 */
const FAKE = {
  project: {
    id: 'specimen',
    name: 'Specimen',
    root: '',
    uname: 'Specimen',
    engine: { version: '5.4', dir: '' },
  } as unknown as UeProject,
  state: undefined,
  reload: () => undefined,
  target: {},
  setTarget: () => undefined,
  section: 'assets',
  sub: '',
  go: () => undefined,
  reloadBadges: () => undefined,
  openShot: () => undefined,
  openJump: () => undefined,
  setWide: () => undefined,
} as UeCtx

/** UMG 布局：控件树、动画、近似预览、细节、时间轴，全在一份示例配置上 */
export function UmgLayoutSpecimen({ height = 640 }: { height?: number }) {
  return (
    <Ctx.Provider value={FAKE}>
      <div
        className="ue:flex ue:w-full ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line"
        style={{ height }}
      >
        <AssetView
          path="/Game/UI/WBP_Sample.WBP_Sample"
          onComp={() => undefined}
          onOpen={() => undefined}
          config={{ text: UMG_SAMPLE }}
          offline
        />
      </div>
    </Ctx.Provider>
  )
}

/** 共用的动画时间轴：几条轨道、三种插值的关键帧形状、能播放和拖播放头 */
export function TimelineSpecimen() {
  const [time, setTime] = useState(0.3)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [sel, setSel] = useState<KeyRef>()
  return (
    <div className="ue:flex ue:h-[260px] ue:w-full ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
      <Timeline
        title={t('动画')}
        groups={[
          {
            id: 'hero',
            label: 'Hero',
            channels: [
              {
                id: 'op',
                label: 'Render Opacity',
                keys: [
                  { time: 0, value: 0, interp: 'cubic' },
                  { time: 0.3, value: 0.85, interp: 'linear' },
                  { time: 0.5, value: 1, interp: 'cubic' },
                ],
              },
              {
                id: 'tx',
                label: 'Render Transform · Translation.X',
                keys: [
                  { time: 0, value: 80, interp: 'constant' },
                  { time: 0.5, value: 0, interp: 'cubic' },
                ],
              },
            ],
          },
          {
            id: 'side',
            label: 'SideWidth',
            channels: [
              {
                id: 'tx',
                label: 'Render Transform · Translation.X',
                keys: [
                  { time: 0, value: -260, interp: 'cubic' },
                  { time: 0.35, value: 0, interp: 'cubic' },
                ],
              },
            ],
          },
        ]}
        length={0.8}
        time={time}
        onTime={setTime}
        playing={playing}
        onPlaying={setPlaying}
        loop={loop}
        onLoop={setLoop}
        selectedKey={sel}
        onSelectKey={setSel}
      />
    </div>
  )
}

/** 资源查看布局的设置表 */
export function LayoutSettingsSpecimen() {
  return (
    <div className="ue:w-full ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
      <LayoutSettings />
    </div>
  )
}
