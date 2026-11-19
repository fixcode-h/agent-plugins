import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/** 静态网格（设计稿第 3 节、效果图 B5）：页头统计条、中间 UE 渲染的视口（拖动转视角）、右边细节（LOD、材质槽、碰撞） */
export const staticMeshDef: LayoutDef = {
  id: 'static-mesh',
  label: () => t('静态网格：统计 + 视口 + 细节'),
  classes: () => ['StaticMesh'],
  priority: 30,
  match: (i) => !i.path.includes(':') && isA(i, 'StaticMesh'),
  regions: [{ id: 'details', label: () => t('细节'), place: 'right', size: '400px', min: 260 }],
}
