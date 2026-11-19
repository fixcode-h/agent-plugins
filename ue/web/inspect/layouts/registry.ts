import type { ComponentType } from 'react'
import { BlueprintLayout } from './blueprint/BlueprintLayout.tsx'
import { DataTableLayout } from './datatable/DataTableLayout.tsx'
import { LAYOUT_DEFS } from './defs.ts'
import { GenericLayout } from './generic/GenericLayout.tsx'
import { pickLayout } from './pick.ts'
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
  generic: GenericLayout,
}

export const LAYOUTS: Layout[] = LAYOUT_DEFS.map((d) => ({ ...d, Component: COMPONENTS[d.id] ?? GenericLayout }))

export const layoutFor = (info: LayoutInfo): Layout => pickLayout(LAYOUTS, info)
