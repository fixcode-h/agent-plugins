import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/** 贴图（设计稿第 3 节、效果图 B4）：中间大图（通道切换）、右边细节；尺寸格式在页头统计条 */
export const textureDef: LayoutDef = {
  id: 'texture',
  label: () => t('贴图：大图 + 细节'),
  classes: () => ['Texture2D', 'TextureCube', 'TextureRenderTarget2D', 'Texture'],
  priority: 30,
  match: (i) =>
    !i.path.includes(':') && (isA(i, 'Texture') || /^Texture(2D|Cube|2DArray|RenderTarget2D)$/.test(i.cls ?? '')),
  regions: [{ id: 'details', label: () => t('细节'), place: 'right', size: '380px', min: 260 }],
}
