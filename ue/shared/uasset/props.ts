/**
 * 属性层：带标签的属性（UE 5.4 起的格式）。每条标签 = 名字 + 完整类型 + 值的字节数 + 标志字节，
 * 所以不需要 C++ 反射也能读出名字和类型；值读不懂（没登记的二进制结构、少见的文本格式）时按字节数整段跳过，
 * 记成 { _unread } 而不是读坏后面的属性（设计文档第 4.3 节）。
 */
import type { Bytes } from './bytes.ts'
import { UassetError } from './errors.ts'
import { t } from './i18n.ts'
import { readName, type Package } from './package.ts'
import { readObjectRef, readSoftPath } from './refs.ts'
import { structCodec } from './structs.ts'
// 引擎结构的布局登记在这个文件里，要在 structs.ts 之后执行（它用 structs.ts 的 registerStruct）
import './structs-engine.ts'
import { readText } from './text.ts'
import { cppType, param, readTypeName, typeText, type TypeNode } from './types.ts'

const HAS_ARRAY_INDEX = 0x01
const HAS_PROPERTY_GUID = 0x02
const HAS_EXTENSIONS = 0x04
const HAS_BINARY_OR_NATIVE = 0x08
const BOOL_TRUE = 0x10
const EXT_OVERRIDABLE = 0x02

export interface RawProp {
  name: string
  /** 显示用的 C++ 写法 */
  type: string
  /** 完整类型树的文字形式（StructProperty(Vector(/Script/CoreUObject))） */
  typeName: string
  node: TypeNode
  arrayIndex: number
  value: unknown
}

/** 读不懂的一段：原因 + 字节数，界面显示「这一项没读」 */
export interface Unread {
  _unread: string
  bytes: number
}

export const isUnread = (v: unknown): v is Unread => !!v && typeof v === 'object' && '_unread' in (v as object)

/** 从当前位置读一串带标签的属性，到 None 为止；end 是这一段的终点（防越界） */
export function readTagged(r: Bytes, pkg: Package, end: number): RawProp[] {
  const out: RawProp[] = []
  for (let guard = 0; guard < 100000; guard++) {
    if (r.pos >= end) throw new UassetError('corrupt', t('属性区没有以 None 结尾'))
    const name = readName(r, pkg.names)
    if (name === 'None') return out
    const node = readTypeName(r, pkg.names)
    const size = r.i32()
    const flags = r.u8()
    const arrayIndex = flags & HAS_ARRAY_INDEX ? r.i32() : 0
    if (flags & HAS_PROPERTY_GUID) r.skip(16)
    if (flags & HAS_EXTENSIONS && r.u8() & EXT_OVERRIDABLE) r.skip(2)
    const start = r.pos
    if (size < 0 || start + size > end)
      throw new UassetError('corrupt', t('属性 {name} 的长度超出了所在的对象', { name }))
    let value: unknown
    try {
      value = node.name === 'BoolProperty' ? !!(flags & BOOL_TRUE) : topValue(r, pkg, node, size, flags)
      if (!isUnread(value) && r.pos !== start + size) value = unread(t('读出来的长度和标签对不上'), size)
    } catch (e) {
      value = unread((e as Error).message, size)
    }
    r.seek(start + size)
    out.push({ name, type: cppType(node), typeName: typeText(node), node, arrayIndex, value })
  }
  throw new UassetError('corrupt', t('属性太多，文件可能坏了'))
}

const unread = (why: string, bytes: number): Unread => ({ _unread: why, bytes })

/** 单个属性的值：字节数已知，结构体看标签上的二进制标志 */
function topValue(r: Bytes, pkg: Package, node: TypeNode, size: number, flags: number): unknown {
  if (node.name === 'StructProperty') {
    const name = param(node)
    // 标签上标了按二进制存才用布局表；没标的按带标签读（同名结构在不同上下文都按这个标志走）
    if (!(flags & HAS_BINARY_OR_NATIVE)) return structObject(readTagged(r, pkg, r.pos + size))
    const codec = structCodec(name)
    if (codec) return codec(r, pkg, size)
    return unread(t('结构 {s} 按二进制存，还不认得它的布局', { s: name }), size)
  }
  if (node.name === 'ByteProperty') {
    // 带枚举的字节存的是枚举值的名字，不带的是一个字节
    if (size === 8) return enumName(readName(r, pkg.names))
    return r.u8()
  }
  return itemValue(r, pkg, node, r.pos + size)
}

/** 容器元素和其他属性的值（没有逐项的字节数，按类型读） */
export function itemValue(r: Bytes, pkg: Package, node: TypeNode, end: number): unknown {
  switch (node.name) {
    case 'BoolProperty':
      return r.u8() !== 0
    case 'ByteProperty':
      return r.u8()
    case 'Int8Property':
      return r.i8()
    case 'Int16Property':
      return r.i16()
    case 'IntProperty':
      return r.i32()
    case 'Int64Property':
      return r.i64Value()
    case 'UInt16Property':
      return r.u16()
    case 'UInt32Property':
      return r.u32()
    case 'UInt64Property':
      return r.u64Value()
    case 'FloatProperty':
      return r.f32()
    case 'DoubleProperty':
      return r.f64()
    case 'StrProperty':
      return r.fstring()
    case 'NameProperty':
      return readName(r, pkg.names)
    case 'EnumProperty':
      return enumName(readName(r, pkg.names))
    case 'TextProperty':
      return readText(r, pkg)
    case 'ObjectProperty':
    case 'WeakObjectProperty':
    case 'ClassProperty':
    case 'InterfaceProperty':
      return readObjectRef(r, pkg)
    case 'LazyObjectProperty':
      return r.guid()
    case 'SoftObjectProperty':
    case 'SoftClassProperty':
      return readSoftPath(r, pkg)
    case 'StructProperty': {
      const codec = structCodec(param(node))
      if (codec) return codec(r, pkg, -1)
      return structObject(readTagged(r, pkg, end))
    }
    case 'ArrayProperty':
      return readList(r, pkg, node.params[0], end)
    case 'SetProperty': {
      const removed = r.i32()
      for (let i = 0; i < removed; i++) itemValue(r, pkg, node.params[0], end)
      return readList(r, pkg, node.params[0], end)
    }
    case 'MapProperty':
      return readMap(r, pkg, node, end)
    case 'DelegateProperty': {
      const obj = readObjectRef(r, pkg)
      const fn = readName(r, pkg.names)
      return fn === 'None' ? '' : `${obj ?? ''}.${fn}`
    }
    case 'MulticastDelegateProperty':
    case 'MulticastInlineDelegateProperty':
    case 'MulticastSparseDelegateProperty': {
      const n = r.i32()
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const obj = readObjectRef(r, pkg)
        out.push(`${obj ?? ''}.${readName(r, pkg.names)}`)
      }
      return out
    }
    case 'FieldPathProperty': {
      const n = r.i32()
      const parts: string[] = []
      for (let i = 0; i < n; i++) parts.push(readName(r, pkg.names))
      const owner = readObjectRef(r, pkg)
      return owner ? `${owner}:${parts.reverse().join('.')}` : parts.reverse().join('.')
    }
    case 'OptionalProperty':
      return r.bool32() ? itemValue(r, pkg, node.params[0], end) : null
    default:
      throw new UassetError('unsupported', t('还不认得 {type} 类型的属性', { type: node.name }))
  }
}

function readList(r: Bytes, pkg: Package, inner: TypeNode | undefined, end: number): unknown[] {
  if (!inner) throw new UassetError('corrupt', t('容器属性缺元素类型'))
  const n = r.i32()
  if (n < 0 || n > end - r.pos) throw new UassetError('corrupt', t('容器的元素个数（{n}）不对', { n }))
  const out: unknown[] = []
  for (let i = 0; i < n; i++) out.push(itemValue(r, pkg, inner, end))
  return out
}

/** 映射：JSON 里写成对象（键转成字符串，和 FJsonObjectConverter 一样）；结构体当键时写成 [{key, value}] */
function readMap(r: Bytes, pkg: Package, node: TypeNode, end: number): unknown {
  const [k, v] = node.params
  if (!k || !v) throw new UassetError('corrupt', t('映射属性缺键或值的类型'))
  const removed = r.i32()
  for (let i = 0; i < removed; i++) itemValue(r, pkg, k, end)
  const n = r.i32()
  if (n < 0 || n > end - r.pos) throw new UassetError('corrupt', t('映射的元素个数（{n}）不对', { n }))
  const pairs: [unknown, unknown][] = []
  for (let i = 0; i < n; i++) pairs.push([itemValue(r, pkg, k, end), itemValue(r, pkg, v, end)])
  if (pairs.every(([key]) => typeof key !== 'object' || key === null)) {
    const o: Record<string, unknown> = {}
    for (const [key, val] of pairs) o[String(key)] = val
    return o
  }
  return pairs.map(([key, value]) => ({ key, value }))
}

/** 结构体成员：名字首字母小写（FJsonObjectConverter 的写法），静态数组的第 n 项单独成一条 */
export function structObject(props: RawProp[]): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const p of props) {
    const key = lowerFirst(p.name)
    if (p.arrayIndex) {
      const prev = o[key]
      o[key] = Array.isArray(prev) ? [...prev, p.value] : [prev, p.value]
    } else o[key] = p.value
  }
  return o
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** EFoo::Bar → Bar（桥接按枚举值的短名给） */
const enumName = (s: string) => {
  const i = s.lastIndexOf('::')
  return i >= 0 ? s.slice(i + 2) : s
}
