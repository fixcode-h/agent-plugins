import type { PathSeg } from '../../../../shared/forge-doc/locate.ts'
import { ForgeMarkupView } from './ForgeMarkupView.tsx'

/**
 * 设置 →「组件」里标记视图的示例：一小份 UMG 配置（样式、颜色、边距、子界面 ref、关键帧两种写法、片段来的节点和段），
 * 假数据，不连 UE；点标签没有去处（不给 onJump）。
 */
const DOC = {
  '//': '商店页：左边导航，右边内容',
  kind: 'umg-widget',
  schemaVersion: 1,
  revision: 7,
  asset: '/Game/UI/WBP_Shop',
  parent: '/Script/UMG.UserWidget',
  styles: {
    NavButton: {
      props: { BackgroundColor: { R: 0.02, G: 0.03, B: 0.05, A: 1 } },
      slot: { Padding: { Left: 8, Top: 4, Right: 8, Bottom: 4 } },
    },
  },
  root: {
    class: 'Overlay',
    name: 'Root',
    children: [
      {
        class: 'VerticalBox',
        name: 'Side',
        children: [
          { class: 'Button', name: 'Go_Page_Shop__Nav', style: 'NavButton', isVariable: true },
          {
            class: 'TextBlock',
            name: 'Title',
            props: {
              Text: '商店',
              Font: { Size: 16, TypefaceFontName: 'Bold' },
              ColorAndOpacity: { SpecifiedColor: { R: 0.9, G: 0.55, B: 0.2, A: 1 } },
            },
            slot: { HorizontalAlignment: 'HAlign_Left' },
          },
        ],
      },
      { ref: 'pages/Shop', name: 'ShopPage' },
    ],
  },
  animations: [
    {
      name: 'PageIn',
      tracks: [
        {
          target: 'Root/ShopPage',
          channel: 'RenderOpacity',
          keys: [[0, 0], { time: 0.3, value: 0.85, interp: 'cubic' }, [0.45, 1]],
        },
      ],
    },
  ],
}

const fragmentAt = (p: PathSeg[]) =>
  p[0] === 'animations'
    ? 'umg/UI/WBP_Shop.parts/animations.json'
    : p.length === 3 && p[2] === 0
      ? 'umg/UI/WBP_Shop.parts/Side.json'
      : undefined

export function ForgeMarkupSpecimen() {
  return (
    <div className="ue:flex ue:h-[460px] ue:w-full ue:flex-col">
      <ForgeMarkupView doc={DOC} fragmentAt={fragmentAt} />
    </div>
  )
}
