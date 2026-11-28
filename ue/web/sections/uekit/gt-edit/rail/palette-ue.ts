import { t } from '../../../../host.ts'
import { registerPaletteCell } from './palette.ts'

/**
 * 节点块里 UE 常用工具的三格（设计稿「GameTest常用UE工具与卡住断开区分」3.1）：插入项在 gt-blocks/map-open.tsx、
 * leaf-items-ue.ts 按组登记，这里只按组取。order 排在「一步操作」(10) 和「子图」(20) 之后、「如果」(40) 之前，
 * 留出 21–39 给别的格子（GM、对象调用、写 Lua）
 */
registerPaletteCell({ id: 'map', label: () => t('地图 / PIE'), groups: () => [t('地图 / PIE')], order: 30 })
registerPaletteCell({ id: 'input', label: () => t('玩家输入'), groups: () => [t('玩家输入')], order: 32 })
registerPaletteCell({ id: 'observe', label: () => t('观察 / 证据'), groups: () => [t('观察 / 证据')], order: 34 })
