import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 材质（设计稿第 3 节、效果图 B2）：左参数和节点列表、中 UE 渲染的材质球（asset.preview）、右细节。
 * 材质函数、参数集合不是 UMaterial，不走这里
 */
export const materialDef: LayoutDef = {
  id: 'material',
  label: () => t('材质：参数和节点 + 预览 + 细节'),
  classes: () => ['Material'],
  priority: 30,
  match: (i) => !i.path.includes(':') && isA(i, 'Material'),
  regions: [
    { id: 'list', label: () => t('参数和节点'), place: 'left', size: '300px', min: 200 },
    { id: 'details', label: () => t('细节'), place: 'right', size: '380px', min: 260 },
  ],
}

/** 材质实例（效果图 B3）：左父材质链和覆盖的参数、中预览、右细节 */
export const materialInstanceDef: LayoutDef = {
  id: 'material-instance',
  label: () => t('材质实例：父材质链和参数覆盖 + 预览 + 细节'),
  classes: () => ['MaterialInstanceConstant', 'MaterialInstance'],
  priority: 30,
  match: (i) => !i.path.includes(':') && (isA(i, 'MaterialInstance') || i.cls === 'MaterialInstanceConstant'),
  regions: [
    { id: 'list', label: () => t('父材质链和参数覆盖'), place: 'left', size: '320px', min: 220 },
    { id: 'details', label: () => t('细节'), place: 'right', size: '400px', min: 260 },
  ],
}
