/**
 * 引擎里常见的、按二进制或自己写 Serialize 存的结构（structs.ts 是数学类型）。没登记的结构在文件里读成「没读出来」，
 * 属性面板上就缺一块：曲线关键帧（时间轴、曲线资源）、PerPlatform / PerQuality（网格的 LOD、屏幕尺寸）、InstancedStruct（状态树、
 * 结构体工具）、材质输入……布局对着引擎各结构的 Serialize 写，长度不确定的在属性标签给了字节数时核对。
 */
import type { Bytes } from './bytes.ts'
import { customVersion, readName, type Package } from './package.ts'
import { readTagged, structObject } from './props.ts'
import { readObjectRef } from './refs.ts'
import { registerStruct } from './structs.ts'

const vec3 = (r: Bytes, size: number) =>
  size === 12 ? { x: r.f32(), y: r.f32(), z: r.f32() } : { x: r.f64(), y: r.f64(), z: r.f64() }
const vec3d = (r: Bytes) => ({ x: r.f64(), y: r.f64(), z: r.f64() })
const plane = (r: Bytes) => ({ x: r.f64(), y: r.f64(), z: r.f64(), w: r.f64() })

registerStruct('Matrix', (r) => ({ xPlane: plane(r), yPlane: plane(r), zPlane: plane(r), wPlane: plane(r) }))
registerStruct('TwoVectors', (r) => ({ v1: vec3d(r), v2: vec3d(r) }))
registerStruct('Sphere', (r) => ({ center: vec3d(r), w: r.f64() }))
registerStruct('BoxSphereBounds', (r) => ({ origin: vec3d(r), boxExtent: vec3d(r), sphereRadius: r.f64() }))
registerStruct('IntRect', (r) => ({ min: { x: r.i32(), y: r.i32() }, max: { x: r.i32(), y: r.i32() } }))
registerStruct('IntVector4', (r) => ({ x: r.i32(), y: r.i32(), z: r.i32(), w: r.i32() }))
registerStruct('RandomStream', (r) => ({ initialSeed: r.i32(), seed: r.i32() }))
for (const n of ['Vector_NetQuantize', 'Vector_NetQuantize10', 'Vector_NetQuantize100', 'Vector_NetQuantizeNormal'])
  registerStruct(n, (r, _p, size) => vec3(r, size))

// 曲线关键帧（FRichCurveKey 自己写 Serialize）：三个枚举字节 + 六个 float
const INTERP = ['RCIM_Linear', 'RCIM_Constant', 'RCIM_Cubic', 'RCIM_None']
const TANGENT = ['RCTM_Auto', 'RCTM_User', 'RCTM_Break', 'RCTM_None', 'RCTM_SmartAuto']
const WEIGHT = ['RCTWM_WeightedNone', 'RCTWM_WeightedArrive', 'RCTWM_WeightedLeave', 'RCTWM_WeightedBoth']
registerStruct('RichCurveKey', (r) => {
  const interpMode = INTERP[r.u8()] ?? 'RCIM_Cubic'
  const tangentMode = TANGENT[r.u8()] ?? 'RCTM_Auto'
  const tangentWeightMode = WEIGHT[r.u8()] ?? 'RCTWM_WeightedNone'
  return {
    interpMode,
    tangentMode,
    tangentWeightMode,
    time: r.f32(),
    value: r.f32(),
    arriveTangent: r.f32(),
    arriveTangentWeight: r.f32(),
    leaveTangent: r.f32(),
    leaveTangentWeight: r.f32(),
  }
})
registerStruct('SimpleCurveKey', (r) => ({ time: r.f32(), value: r.f32() }))
registerStruct('StringCurveKey', (r) => ({ time: r.f32(), value: r.fstring() }))
registerStruct('NavAgentSelector', (r) => ({ packedBits: r.u32() }))
registerStruct('TopLevelAssetPath', (r, pkg) => {
  const p = readName(r, pkg.names)
  const a = readName(r, pkg.names)
  return p === 'None' ? '' : a && a !== 'None' ? `${p}.${a}` : p
})

/**
 * TPerPlatformProperty：bCooked（4 字节布尔）、Default、没烘焙时再跟一个「平台名 → 值」的映射。
 * 照 UELink（FJsonObjectConverter）的写法给 { default, perPlatform }
 */
function perPlatform(read: (r: Bytes, pkg: Package) => unknown) {
  return (r: Bytes, pkg: Package) => {
    const cooked = r.bool32()
    const def = read(r, pkg)
    const per: Record<string, unknown> = {}
    if (!cooked) {
      const n = r.i32()
      for (let i = 0; i < n && i < 256; i++) per[readName(r, pkg.names)] = read(r, pkg)
    }
    return { default: def, perPlatform: per }
  }
}
registerStruct(
  'PerPlatformFloat',
  perPlatform((r) => r.f32()),
)
registerStruct(
  'PerPlatformInt',
  perPlatform((r) => r.i32()),
)
registerStruct(
  'PerPlatformBool',
  perPlatform((r) => r.bool32()),
)
registerStruct(
  'PerPlatformFrameRate',
  perPlatform((r) => ({ numerator: r.i32(), denominator: r.i32() })),
)

/** TPerQualityLevelProperty：bCooked、Default、「画质档位 → 值」的映射（总是有） */
function perQuality(read: (r: Bytes) => unknown) {
  return (r: Bytes) => {
    r.bool32()
    const def = read(r)
    const per: Record<string, unknown> = {}
    const n = r.i32()
    for (let i = 0; i < n && i < 64; i++) per[String(r.i32())] = read(r)
    return { default: def, perQuality: per }
  }
}
registerStruct(
  'PerQualityLevelFloat',
  perQuality((r) => r.f32()),
)
registerStruct(
  'PerQualityLevelInt',
  perQuality((r) => r.i32()),
)

// TRange<float>：两个边界，每个是「类型（开、闭、无界）一个字节 + 值」；老格式只有两个 float
const BOUND = ['Exclusive', 'Inclusive', 'Open']
registerStruct('FloatRange', (r, _p, size) => {
  if (size === 8) return { lowerBound: { value: r.f32() }, upperBound: { value: r.f32() } }
  const bound = () => ({ type: BOUND[r.u8()] ?? 'Open', value: r.f32() })
  return { lowerBound: bound(), upperBound: bound() }
})

registerStruct('ViewTargetBlendParams', (r) => ({
  blendTime: r.f32(),
  blendFunction: r.u8(),
  blendExp: r.f32(),
  bLockOutgoing: r.i32() !== 0,
}))

/** FInstancedStruct（5.3 起带自定义版本，之前是 0xABABABAB 头 + 版本字节）：结构类型 + 字节数 + 带标签的成员 */
const INSTANCED_STRUCT = 'e21e1caaaf47425e89bf6ad44c44a8bb'
registerStruct('InstancedStruct', (r, pkg) => {
  if (customVersion(pkg, INSTANCED_STRUCT) < 0) {
    r.u32()
    r.u8()
  }
  const struct = readObjectRef(r, pkg) ?? ''
  const size = r.i32()
  if (!struct) {
    r.skip(Math.max(0, size))
    return null
  }
  const end = r.pos + size
  const value = structObject(readTagged(r, pkg, end))
  r.seek(end)
  return { scriptStruct: struct, value }
})

/**
 * 材质输入（FExpressionInput 系列，自己写 Serialize）：连着的表达式、输出下标、输入名、掩码；带常量的再跟「用不用常量 + 常量」。
 * 常量的长度按属性标签的字节数核对（向量常量 5.x 是 float）
 */
function exprInput(r: Bytes, pkg: Package) {
  const expression = readObjectRef(r, pkg) ?? ''
  const outputIndex = r.i32()
  const inputName = readName(r, pkg.names)
  const mask = [r.i32(), r.i32(), r.i32(), r.i32(), r.i32()]
  return {
    expression,
    outputIndex,
    inputName: inputName === 'None' ? '' : inputName,
    mask: mask[0],
    maskR: mask[1],
    maskG: mask[2],
    maskB: mask[3],
    maskA: mask[4],
  }
}
registerStruct('ExpressionInput', (r, pkg) => exprInput(r, pkg))
registerStruct('MaterialAttributesInput', (r, pkg) => exprInput(r, pkg))
registerStruct('ColorMaterialInput', (r, pkg) => {
  const base = exprInput(r, pkg)
  const useConstant = r.bool32()
  const b = r.u8()
  const g = r.u8()
  const rr = r.u8()
  const a = r.u8()
  return { ...base, useConstant, constant: { r: rr, g, b, a } }
})
registerStruct('ScalarMaterialInput', (r, pkg) => ({
  ...exprInput(r, pkg),
  useConstant: r.bool32(),
  constant: r.f32(),
}))
registerStruct('VectorMaterialInput', (r, pkg, size) => {
  const start = r.pos
  const base = exprInput(r, pkg)
  const useConstant = r.bool32()
  const left = size > 0 ? size - (r.pos - start) : 12
  return { ...base, useConstant, constant: vec3(r, left === 24 ? 24 : 12) }
})
registerStruct('Vector2MaterialInput', (r, pkg) => ({
  ...exprInput(r, pkg),
  useConstant: r.bool32(),
  constant: { x: r.f32(), y: r.f32() },
}))
registerStruct('ShadingModelMaterialInput', (r, pkg) => ({
  ...exprInput(r, pkg),
  useConstant: r.bool32(),
  constant: r.u32(),
}))
