import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * DataAsset / PrimaryDataAsset（设计稿第 3 节、效果图 B8 左边）：左边分类索引（点一下只看这个分类，可关），中间宽版细节面板。
 * 蓝图子类的数据资产（ForgeConfigData）类链里有 DataAsset，一起走这里
 */
export const dataAssetDef: LayoutDef = {
  id: 'dataasset',
  label: () => t('数据资产：分类索引 + 宽版细节'),
  classes: () => ['DataAsset', 'PrimaryDataAsset'],
  priority: 30,
  match: (i) => !i.path.includes(':') && isA(i, 'DataAsset'),
  regions: [{ id: 'cats', label: () => t('分类索引'), place: 'left', size: '200px', min: 140, optional: true }],
}
