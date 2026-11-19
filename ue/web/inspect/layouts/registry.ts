import type { ComponentType } from 'react'
import { AudioLayout } from './audio/AudioLayout.tsx'
import { BlueprintLayout } from './blueprint/BlueprintLayout.tsx'
import { CurveLayout } from './curve/CurveLayout.tsx'
import { DataAssetLayout } from './dataasset/DataAssetLayout.tsx'
import { DataTableLayout } from './datatable/DataTableLayout.tsx'
import { LAYOUT_DEFS } from './defs.ts'
import { EnumLayout } from './enum/EnumLayout.tsx'
import { GenericLayout } from './generic/GenericLayout.tsx'
import { MaterialInstanceLayout, MaterialLayout } from './material/MaterialLayout.tsx'
import { StaticMeshLayout } from './mesh/StaticMeshLayout.tsx'
import { NiagaraLayout } from './niagara/NiagaraLayout.tsx'
import { pickLayout } from './pick.ts'
import { StructLayout } from './struct/StructLayout.tsx'
import { SkeletalLayout } from './skeletal/SkeletalLayout.tsx'
import { TextureLayout } from './texture/TextureLayout.tsx'
import type { Layout, LayoutInfo, LayoutProps } from './types.ts'
import { UmgLayout } from './umg/UmgLayout.tsx'

/**
 * 资源查看布局注册表（设计稿第 2 节）：布局 id → 组件；元信息（匹配、区域、默认尺寸）在 defs.ts。
 * AssetView 只调 layoutFor，自己不按类型名写分支；设置 →「资源查看布局」按 LAYOUTS 列表
 */
const COMPONENTS: Record<string, ComponentType<LayoutProps>> = {
  umg: UmgLayout,
  datatable: DataTableLayout,
  blueprint: BlueprintLayout,
  dataasset: DataAssetLayout,
  enum: EnumLayout,
  struct: StructLayout,
  curve: CurveLayout,
  material: MaterialLayout,
  'material-instance': MaterialInstanceLayout,
  texture: TextureLayout,
  'static-mesh': StaticMeshLayout,
  skeletal: SkeletalLayout,
  audio: AudioLayout,
  niagara: NiagaraLayout,
  generic: GenericLayout,
}

export const LAYOUTS: Layout[] = LAYOUT_DEFS.map((d) => ({ ...d, Component: COMPONENTS[d.id] ?? GenericLayout }))

export const layoutFor = (info: LayoutInfo): Layout => pickLayout(LAYOUTS, info)
