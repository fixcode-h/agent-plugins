import { audioDef } from './audio/def.ts'
import { blueprintDef } from './blueprint/def.ts'
import { dataTableDef } from './datatable/def.ts'
import { genericDef } from './generic/def.ts'
import { materialDef, materialInstanceDef } from './material/def.ts'
import { staticMeshDef } from './mesh/def.ts'
import { niagaraDef } from './niagara/def.ts'
import { skeletalDef } from './skeletal/def.ts'
import { textureDef } from './texture/def.ts'
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
  // 预览类（第四期）：asset.preview 画中间，细节在右
  materialDef,
  materialInstanceDef,
  textureDef,
  staticMeshDef,
  skeletalDef,
  audioDef,
  niagaraDef,
  genericDef,
]
