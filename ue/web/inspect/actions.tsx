import { Copy, ExternalLink, LocateFixed, MessageSquare, Pin, PinOff } from 'lucide-react'
import { op, useAction } from '../api.ts'
import { useToChat } from '../chat.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { copyText } from '../menu.tsx'
import { describeObject, type Prop } from '../Props.tsx'
import { useTargetInfo } from '../ui.tsx'
import type { NavPage } from './history.ts'
import { usePins } from './Pins.tsx'

/**
 * 导航条右边的动作槽（设计稿第 5 节）：跟着当前看的东西走——在资源页打开（对象页看资源时）、在文件夹里定位（资源页）、
 * 固定（原来页头上的「固定这个对象」挪到这里）、复制路径、发给对话
 */
export function InspectorActions({
  page,
  path,
  comp,
  asset,
  onOpenAssets,
  onReveal,
}: {
  page: NavPage
  path: string
  comp?: string
  asset: boolean
  onOpenAssets: () => void
  onReveal?: (path: string) => void
}) {
  const { project, target } = useUe()
  const { world } = useTargetInfo()
  const { ui } = h()
  const pins = usePins()
  const chat = useToChat()
  const { busy, run } = useAction()
  const pinned = pins.has(path)
  const obj = comp || path
  // 发给对话：带上属性值（和原来属性面板上的按钮一样），这里现读一次
  const send = () =>
    run('chat', async () => {
      const d = await op<{ object: { path: string; name: string; class: string }; props: Prop[] }>(
        project.id,
        'props',
        { path: obj, filter: '', maxChars: 400 },
        target,
      )
      chat.send(describeObject(obj, d, d.props, asset ? undefined : world))
    })
  return (
    <>
      {asset && page === 'objects' && (
        <ui.IconButton icon={ExternalLink} label={t('在资源页打开（在那里保存）')} size="sm" onClick={onOpenAssets} />
      )}
      {asset && onReveal && (
        <ui.IconButton icon={LocateFixed} label={t('在文件夹里定位')} size="sm" onClick={() => onReveal(path)} />
      )}
      <ui.IconButton
        icon={pinned ? PinOff : Pin}
        label={pinned ? t('取消固定') : t('固定这个对象')}
        size="sm"
        onClick={() => void pins.toggle(path)}
      />
      <ui.IconButton icon={Copy} label={t('复制路径')} size="sm" onClick={() => copyText(obj)} />
      {chat.available && (
        <ui.Button size="sm" variant="secondary" disabled={busy === 'chat'} onClick={() => void send()}>
          <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
        </ui.Button>
      )}
      {chat.dialog}
    </>
  )
}
