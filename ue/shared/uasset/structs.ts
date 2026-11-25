/**
 * 按二进制存的结构体（声明了 WithSerializer、或引擎登记成整块存的）：没有标签，要按布局一个个读。
 * 注册表：结构名 → 读取函数。没登记的结构，单个属性按标签上的字节数跳过并标「没读」，数组里的当带标签的结构读，
 * 读不通再整段跳过（props.ts）。5.0 起向量、旋转、四元数都是 double（大世界坐标）。
 * 值的形状照桥接 props 操作的 JSON（FJsonObjectConverter：成员名首字母小写），两条路读出来能对得上。
 */
import type { Bytes } from './bytes.ts'
import { readName, type Package } from './package.ts'
import { pinTypeText, readPinType } from './pins.ts'
import { readSoftPath } from './refs.ts'

export type StructCodec = (r: Bytes, pkg: Package, size: number) => unknown

const codecs = new Map<string, StructCodec>()

export function registerStruct(name: string, codec: StructCodec) {
  codecs.set(name, codec)
}

export const structCodec = (name: string) => codecs.get(name)

const vec3 = (r: Bytes) => ({ x: r.f64(), y: r.f64(), z: r.f64() })
const vec3f = (r: Bytes) => ({ x: r.f32(), y: r.f32(), z: r.f32() })
const vec2 = (r: Bytes) => ({ x: r.f64(), y: r.f64() })

// 单个属性时标签上有字节数：12 字节的是旧的 float 版，按实际长度读
registerStruct('Vector', (r, _p, size) => (size === 12 ? vec3f(r) : vec3(r)))
registerStruct('Vector3d', (r) => vec3(r))
registerStruct('Vector3f', (r) => vec3f(r))
registerStruct('Vector2D', (r, _p, size) => (size === 8 ? { x: r.f32(), y: r.f32() } : vec2(r)))
registerStruct('Vector2f', (r) => ({ x: r.f32(), y: r.f32() }))
registerStruct('Vector4', (r, _p, size) =>
  size === 16 ? { x: r.f32(), y: r.f32(), z: r.f32(), w: r.f32() } : { x: r.f64(), y: r.f64(), z: r.f64(), w: r.f64() },
)
registerStruct('Vector4f', (r) => ({ x: r.f32(), y: r.f32(), z: r.f32(), w: r.f32() }))
registerStruct('Plane', (r) => ({ x: r.f64(), y: r.f64(), z: r.f64(), w: r.f64() }))
registerStruct('Rotator', (r, _p, size) =>
  size === 12 ? { pitch: r.f32(), yaw: r.f32(), roll: r.f32() } : { pitch: r.f64(), yaw: r.f64(), roll: r.f64() },
)
registerStruct('Quat', (r, _p, size) =>
  size === 16 ? { x: r.f32(), y: r.f32(), z: r.f32(), w: r.f32() } : { x: r.f64(), y: r.f64(), z: r.f64(), w: r.f64() },
)
registerStruct('IntPoint', (r) => ({ x: r.i32(), y: r.i32() }))
registerStruct('IntVector2', (r) => ({ x: r.i32(), y: r.i32() }))
registerStruct('IntVector', (r) => ({ x: r.i32(), y: r.i32(), z: r.i32() }))
registerStruct('Box', (r) => ({ min: vec3(r), max: vec3(r), isValid: r.u8() !== 0 }))
registerStruct('Box2D', (r) => ({ min: vec2(r), max: vec2(r), bIsValid: r.u8() !== 0 }))
// FGuid 导出成文本（32 位十六进制大写），和编辑器里看到的一样
registerStruct('Guid', (r) => r.guid().toUpperCase())
// FColor 在内存里是 BGRA
registerStruct('Color', (r) => {
  const b = r.u8()
  const g = r.u8()
  const rr = r.u8()
  const a = r.u8()
  return { b, g, r: rr, a }
})
registerStruct('LinearColor', (r) => ({ r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() }))
registerStruct('DateTime', (r) => r.i64Value())
registerStruct('Timespan', (r) => r.i64Value())
registerStruct('FrameNumber', (r) => ({ value: r.i32() }))
registerStruct('FrameRate', (r) => ({ numerator: r.i32(), denominator: r.i32() }))
registerStruct('SoftObjectPath', (r, pkg) => readSoftPath(r, pkg))
registerStruct('SoftClassPath', (r, pkg) => readSoftPath(r, pkg))
registerStruct('GameplayTagContainer', (r, pkg) => {
  const n = r.i32()
  const tags: string[] = []
  for (let i = 0; i < n; i++) tags.push(readName(r, pkg.names))
  return { gameplayTags: tags.map((tagName) => ({ tagName })) }
})
// 5.x 的 Slate 二维向量（编辑器里存视图偏移这类）：两个 float
registerStruct('DeprecateSlateVector2D', (r) => ({ x: r.f32(), y: r.f32() }))
// 蓝图变量、函数参数的类型（自己写 Serialize 的结构）：读成编辑器里显示的类型文字
registerStruct('EdGraphPinType', (r, pkg) => pinTypeText(readPinType(r, pkg)))
