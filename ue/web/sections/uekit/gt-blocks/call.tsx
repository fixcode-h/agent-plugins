import { FileCode2 } from 'lucide-react'
import { t } from '../../../host.ts'
import { registerBlockUi } from './registry.ts'
import { SubgraphInspector } from './subgraph.tsx'

/**
 * 挂了脚本的子图（数据是 call：script 相对场景根、with 传参数、saveAs 存子脚本 return 的值）。
 * 插入菜单里只有一个「子图」（group.tsx），在检查器里选了脚本才变成这种
 */
registerBlockUi(
  {
    action: 'call',
    title: () => t('子图'),
    icon: FileCode2,
    tone: 'run',
    summary: (s) => {
      const w = s.with && typeof s.with === 'object' ? Object.entries(s.with) : []
      return [String(s.script ?? ''), ...w.map(([k, v]) => `${k}=${JSON.stringify(v)}`)].join(' · ')
    },
    Inspector: SubgraphInspector,
  },
  // 不单独进插入菜单：插「子图」再在检查器里选脚本
  [],
)
