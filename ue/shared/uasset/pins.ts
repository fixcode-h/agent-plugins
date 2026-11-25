/**
 * 图表节点（UEdGraphNode 及所有 K2Node_*）在带标签属性之后自己存的引脚数组（设计文档第 4.3 节 b）。
 * 每个引脚：所属节点 + 引脚 GUID、名字、显示名（编辑器包才有）、来源下标（UE5MainStream ≥ 50）、提示、方向、引脚类型、
 * 默认值（字符串 / 对象 / 文本）、连线、子引脚、父引脚、引用直通，最后是持久 GUID 和一组位标志（含 bHidden）。
 * 布局照格式核对过 CUE4Parse 的读法；只实现 5.4 起会走到的分支。
 */
import type { Bytes } from './bytes.ts'
import { customVersion, readName, type Package } from './package.ts'
import { readObjectRef } from './refs.ts'
import { readText } from './text.ts'

const UE5_MAIN = '697dd581e64f41abaa4a51ecbeb7b628'
const EDGRAPH_PIN_SOURCE_INDEX = 50
const BLUEPRINTS = 'b0d832e41f894f0daccf7eb736fd4aa2'
const EDGRAPH_PIN_OPTIMIZED = 4

export interface PinRef {
  /** 对端节点在导出表里的下标（FPackageIndex） */
  node: number
  pin: string
}

export interface RawPin {
  id: string
  name: string
  /** 0 输入、1 输出 */
  direction: number
  category: string
  subCategory: string
  subCategoryObject: string | null
  container: number
  isReference: boolean
  defaultValue: string
  defaultObject: string | null
  defaultText: string
  linkedTo: PinRef[]
  hidden: boolean
}

/** 这个包里的节点有没有按优化格式存引脚（5.x 一定有） */
export const hasPins = (pkg: Package) => customVersion(pkg, BLUEPRINTS) >= EDGRAPH_PIN_OPTIMIZED

export function readPins(r: Bytes, pkg: Package): RawPin[] {
  const n = r.i32()
  const out: RawPin[] = []
  for (let i = 0; i < n; i++) {
    if (r.bool32()) continue // 空指针
    // 先是一份引用（所属节点 + 引脚 GUID），引脚本身开头又存一遍
    r.i32()
    r.guid()
    r.i32()
    out.push(readPin(r, pkg, r.guid()))
  }
  return out
}

function readPinRef(r: Bytes): PinRef | null {
  if (r.bool32()) return null
  const node = r.i32()
  return { node, pin: r.guid() }
}

function readPinRefs(r: Bytes): PinRef[] {
  const n = r.i32()
  const out: PinRef[] = []
  for (let i = 0; i < n; i++) {
    const ref = readPinRef(r)
    if (ref) out.push(ref)
  }
  return out
}

function readPin(r: Bytes, pkg: Package, id: string): RawPin {
  const name = readName(r, pkg.names)
  readText(r, pkg) // 显示名
  if (customVersion(pkg, UE5_MAIN) >= EDGRAPH_PIN_SOURCE_INDEX) r.i32()
  r.fstring() // 提示
  const direction = r.u8()
  const type = readPinType(r, pkg)
  const defaultValue = r.fstring()
  r.fstring() // 自动生成的默认值
  const defaultObject = readObjectRef(r, pkg)
  const defaultText = readText(r, pkg)
  const linkedTo = readPinRefs(r)
  readPinRefs(r) // 子引脚
  readPinRef(r) // 父引脚
  readPinRef(r) // 引用直通
  r.skip(16) // 持久 GUID
  const bits = r.u32()
  return { id, name, direction, ...type, defaultValue, defaultObject, defaultText, linkedTo, hidden: !!(bits & 1) }
}

export type PinType = ReturnType<typeof readPinType>

export function readPinType(r: Bytes, pkg: Package) {
  const category = readName(r, pkg.names)
  const subCategory = readName(r, pkg.names)
  const subCategoryObject = readObjectRef(r, pkg)
  const container = r.u8()
  if (container === 3) readTerminalType(r, pkg) // 映射的值类型
  const isReference = r.bool32()
  r.bool32() // 弱指针
  readMemberReference(r, pkg)
  r.bool32() // const
  r.bool32() // UObject 包装
  r.bool32() // 默认值按单精度存
  return { category, subCategory, subCategoryObject, container, isReference }
}

function readTerminalType(r: Bytes, pkg: Package) {
  readName(r, pkg.names)
  readName(r, pkg.names)
  readObjectRef(r, pkg)
  r.bool32()
  r.bool32()
  r.bool32()
}

/** FSimpleMemberReference：所属类 + 名字 + GUID */
function readMemberReference(r: Bytes, pkg: Package) {
  readObjectRef(r, pkg)
  readName(r, pkg.names)
  r.skip(16)
}

const CATEGORY: Record<string, string> = {
  bool: 'Boolean',
  byte: 'Byte',
  int: 'Integer',
  int64: 'Integer64',
  string: 'String',
  name: 'Name',
  text: 'Text',
  exec: 'Exec',
  wildcard: 'Wildcard',
  delegate: 'Delegate',
  mcdelegate: 'Event Dispatcher',
  fieldpath: 'Field Path',
}
const OBJECT_KIND: Record<string, string> = {
  object: 'Object Reference',
  class: 'Class Reference',
  softobject: 'Soft Object Reference',
  softclass: 'Soft Class Reference',
  interface: 'Interface',
}

/** 引脚 / 变量类型的显示文字，大致照编辑器「我的蓝图」里的写法（Integer、Vector Structure、Actor Object Reference、Array of …） */
export function pinTypeText(p: {
  category: string
  subCategory: string
  subCategoryObject: string | null
  container: number
}) {
  const short = (path: string | null) => (path ?? '').split(/[./:]/).pop()?.replace(/_C$/, '') ?? ''
  let base: string
  if (p.category === 'real') base = p.subCategory === 'float' ? 'Float (single-precision)' : 'Float (double-precision)'
  else if (p.category === 'struct') base = `${short(p.subCategoryObject)} Structure`
  else if (p.category === 'byte' && p.subCategoryObject) base = short(p.subCategoryObject)
  else if (OBJECT_KIND[p.category]) base = `${short(p.subCategoryObject) || 'Object'} ${OBJECT_KIND[p.category]}`
  else base = CATEGORY[p.category] ?? p.category
  return p.container === 1
    ? `Array of ${base}`
    : p.container === 2
      ? `Set of ${base}`
      : p.container === 3
        ? `Map of ${base}`
        : base
}
