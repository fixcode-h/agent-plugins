import { Copy, ExternalLink, MessageSquare, Pin } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { InspectorBar, type BarCrumb, type BarRecent } from './InspectorBar.tsx'

const noop = () => undefined

/**
 * 设置 →「组件」里的「检视 · 导航条」：普通（刚在大纲里点了一个 Actor）、带引用链（点了两次引用）、看资源三种静态状态，
 * 能调行高和面包屑前面几段的最大宽度
 */
export function InspectorBarSpecimen() {
  const { ui } = h()
  const [height, setHeight] = useState(44)
  const [crumbMax, setCrumbMax] = useState(220)
  const floor: BarCrumb = { key: 'f', name: 'Floor1', sub: 'StaticMeshComponent0', asset: false, onClick: noop }
  const recent: BarRecent[] = [
    { key: '3', name: 'SM_Template_Map_Floor', asset: true, how: t('经 {p}', { p: 'Static Mesh' }), onClick: noop },
    { key: '2', name: 'Floor1 · StaticMeshComponent0', asset: false, how: t('从大纲'), current: true, onClick: noop },
    { key: '1', name: 'BP_Hero_C_0', asset: false, how: t('从固定的对象'), stale: true, onClick: noop },
  ]
  const actions = (asset: boolean) => (
    <>
      {asset && <ui.IconButton icon={ExternalLink} label={t('在资源页打开（在那里保存）')} size="sm" onClick={noop} />}
      <ui.IconButton icon={Pin} label={t('固定这个对象')} size="sm" onClick={noop} />
      <ui.IconButton icon={Copy} label={t('复制路径')} size="sm" onClick={noop} />
      <ui.Button size="sm" variant="secondary" onClick={noop}>
        <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
      </ui.Button>
    </>
  )
  const box = (label: string, el: ReactNode) => (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <span className="ue:text-caption ue:text-subtle">{label}</span>
      <div className="ue:overflow-hidden ue:border ue:border-line">{el}</div>
    </div>
  )
  const common = { height, crumbMax, onBack: noop, onForward: noop, onClear: noop, recent }
  return (
    <div className="ue:flex ue:w-full ue:flex-col ue:gap-3">
      <div className="ue:flex ue:flex-wrap ue:gap-4 ue:text-footnote ue:text-subtle">
        <label className="ue:flex ue:items-center ue:gap-2">
          {t('行高')}
          <input
            type="range"
            min={36}
            max={56}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            className="ue:accent-accent"
          />
          {height}px
        </label>
        <label className="ue:flex ue:items-center ue:gap-2">
          {t('面包屑段最大宽度')}
          <input
            type="range"
            min={80}
            max={320}
            value={crumbMax}
            onChange={(e) => setCrumbMax(Number(e.target.value))}
            className="ue:accent-accent"
          />
          {crumbMax}px
        </label>
      </div>
      {box(
        t('普通'),
        <InspectorBar
          {...common}
          canBack={false}
          canForward={false}
          crumbs={[{ ...floor, onClick: undefined }]}
          kind="instance"
          actions={actions(false)}
        />,
      )}
      {box(
        t('带引用链'),
        <InspectorBar
          {...common}
          canBack
          canForward={false}
          crumbs={[
            { key: 'h', name: 'WBP_HUD_C_0', sub: 'Ammo', asset: false, onClick: noop },
            { key: 'p', name: 'BP_PlayerController_C_0', asset: false, via: 'Owning Player' },
          ]}
          kind="instance"
          actions={actions(false)}
        />,
      )}
      {box(
        t('看资源'),
        <InspectorBar
          {...common}
          canBack
          canForward
          crumbs={[floor, { key: 's', name: 'SM_Template_Map_Floor', asset: true, via: 'Static Mesh' }]}
          kind="assetRef"
          actions={actions(true)}
        />,
      )}
    </div>
  )
}
