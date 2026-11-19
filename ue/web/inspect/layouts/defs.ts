import { blueprintDef } from './blueprint/def.ts'
import { curveDef } from './curve/def.ts'
import { dataAssetDef } from './dataasset/def.ts'
import { dataTableDef } from './datatable/def.ts'
import { enumDef } from './enum/def.ts'
import { genericDef } from './generic/def.ts'
import { structDef } from './struct/def.ts'
import type { LayoutDef } from './types.ts'
import { umgDef } from './umg/def.ts'

/**
 * 内置布局的元信息（纯数据，设置页和单测用）；registry.ts 给每个配上组件。
 * 加新类型：建一个文件夹（def.ts + 组件），这里和 registry.ts 各加一行
 */
export const LAYOUT_DEFS: LayoutDef[] = [
  umgDef,
  dataTableDef,
  blueprintDef,
  dataAssetDef,
  enumDef,
  structDef,
  curveDef,
  genericDef,
]
