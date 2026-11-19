import { Layers } from 'lucide-react'
import { blockOf } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { registerBlockUi } from './registry.ts'
import { SubgraphInspector } from './subgraph.tsx'

/**
 * 子图（不挂脚本的那种，数据是 group）：里面的步骤在图里自己编辑，录制录出来的也是一段（recorded）。
 * 挂了脚本的是 call（call.tsx），两种在界面上都叫「子图」，检查器里选不选脚本来回换（subgraph.tsx）
 */
registerBlockUi(
  {
    action: 'group',
    title: () => t('子图'),
    icon: Layers,
    tone: 'subtle',
    summary: (s) => {
      const n = Array.isArray(s.do) ? s.do.length : 0
      // 没起名字时不再重复一遍「子图」（标题已经是子图）
      const name = typeof s.name === 'string' && s.name ? s.name : s.recorded ? t('录制') : ''
      return name ? t('{name} · {n} 步', { name, n }) : t('{n} 步', { n })
    },
    Inspector: SubgraphInspector,
  },
  [
    {
      id: 'group',
      group: () => t('结构'),
      label: () => t('子图'),
      hint: () => t('空的双击进去自己连；在检查器里选了脚本就跑那个脚本'),
      slash: 'sub',
      action: 'group',
      make: () => blockOf('group')!.make(),
    },
  ],
)
