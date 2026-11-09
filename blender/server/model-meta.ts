/**
 * 模型设计的预览状态和给 Agent 的提示（原来在面板 shared/plugins/blender/model.ts，面板 ADR 0025）。
 * 插件不带 zod：结构简单，按字段手动补默认值。
 */

/** 场景里的一个物体：桥接脚本 /scene 返回的样子 */
export interface ModelObject {
  name: string
  type: string
  location: number[]
  rotation: number[]
  scale: number[]
  dimensions: number[]
  parent: string
  collection: string
  materials: string[]
  hidden: boolean
  vertices?: number
  faces?: number
  modifiers?: string[]
}

/** 一个模型对话的预览状态：版本号每次执行加一，网页看到变了就重新加载 glb */
export interface ModelMeta {
  version: number
  updatedAt: string
  objects: ModelObject[]
  /** 导出 glb 失败的原因（场景照样存了 .blend） */
  exportError: string
}

const nums = (v: unknown, d: number[]) => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? v : d)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function toObject(raw: unknown): ModelObject {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    name: str(o.name),
    type: str(o.type),
    location: nums(o.location, [0, 0, 0]),
    rotation: nums(o.rotation, [0, 0, 0]),
    scale: nums(o.scale, [1, 1, 1]),
    dimensions: nums(o.dimensions, [0, 0, 0]),
    parent: str(o.parent),
    collection: str(o.collection),
    materials: Array.isArray(o.materials) ? o.materials.map(String) : [],
    hidden: o.hidden === true,
    ...(typeof o.vertices === 'number' && { vertices: o.vertices }),
    ...(typeof o.faces === 'number' && { faces: o.faces }),
    ...(Array.isArray(o.modifiers) && { modifiers: o.modifiers.map(String) }),
  }
}

export function toMeta(raw: unknown): ModelMeta {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const version = typeof m.version === 'number' && Number.isInteger(m.version) && m.version >= 0 ? m.version : 0
  return {
    version,
    updatedAt: str(m.updatedAt),
    objects: Array.isArray(m.objects) ? m.objects.map(toObject) : [],
    exportError: str(m.exportError),
  }
}

/** 物体列表压成给 Agent 看的几行文字：名字、类型、位置、尺寸、面数、材质 */
export function sceneText(objects: ModelObject[]): string {
  if (!objects.length) return '场景是空的。'
  const n = (v: number[]) => v.map((x) => +x.toFixed(3)).join(', ')
  return objects
    .map((o) => {
      const parts = [`${o.name}（${o.type}）`, `位置 (${n(o.location)})`, `尺寸 (${n(o.dimensions)})`]
      if (o.parent) parts.push(`父级 ${o.parent}`)
      if (o.faces !== undefined) parts.push(`${o.faces} 面`)
      if (o.materials.length) parts.push(`材质 ${o.materials.join('、')}`)
      if (o.modifiers?.length) parts.push(`修改器 ${o.modifiers.join('、')}`)
      if (o.hidden) parts.push('隐藏')
      return `- ${parts.join(' · ')}`
    })
    .join('\n')
}

/** 模型对话的提示：工具怎么用、约定是什么（面板拼在用户消息后面） */
export const MODEL_HINT = `## 用 Blender 建模
这是一个模型设计对话，场景在一个后台运行的 Blender 里，用户在网页上实时看到你建出来的模型。
- 用工具 blender_python 执行 bpy 代码来建模、改模型、加材质；每执行一次场景就自动保存并刷新给用户看。可以分几次小步做，每步看一下结果。
- 用工具 blender_scene 查看现在场景里有哪些物体、位置、尺寸和面数。
- 约定：单位是米，Z 轴朝上；每个物体起有意义的英文名字（例如 Chair_Leg_FL），同一部件放进同一个集合；材质用 Principled BSDF，颜色写在 Base Color 上，网页预览才能显示出来。
- 修改器在导出预览时会被应用，几何节点等 Blender 专有的效果预览里可能看不到。
- 不要调用 exit、不要改 Blender 的用户设置或安装插件。`
