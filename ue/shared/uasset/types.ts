/**
 * 属性的完整类型（5.4 起标签里存的 FPropertyTypeName）：先序存的一棵树，每个节点是名字 + 子节点个数。
 * 例：ArrayProperty(StructProperty(Vector(/Script/CoreUObject)))、MapProperty(NameProperty,IntProperty)。
 */
import type { Bytes } from './bytes.ts'
import { readName } from './package.ts'

export interface TypeNode {
  name: string
  params: TypeNode[]
}

export function readTypeName(r: Bytes, names: string[]): TypeNode {
  const flat: { name: string; inner: number }[] = []
  let total = 1
  for (let i = 0; i < total; i++) {
    const name = readName(r, names)
    const inner = r.i32()
    flat.push({ name, inner })
    total += inner
    if (total > 256) break // 防坏数据死循环
  }
  let at = 0
  const build = (): TypeNode => {
    const f = flat[at++] ?? { name: 'None', inner: 0 }
    const params: TypeNode[] = []
    for (let i = 0; i < f.inner; i++) params.push(build())
    return { name: f.name, params }
  }
  return build()
}

export const typeText = (n: TypeNode): string =>
  n.params.length ? `${n.name}(${n.params.map(typeText).join(',')})` : n.name

/** 第 i 个参数的名字（StructProperty 的结构名、ArrayProperty 的元素类型……） */
export const param = (n: TypeNode, i = 0) => n.params[i]?.name ?? ''

/** 显示用的类型：大致照 UE 的 C++ 写法（int32、TArray<FVector>、UStaticMesh*），只用来给人看，不参与比较 */
export function cppType(n: TypeNode): string {
  switch (n.name) {
    case 'BoolProperty':
      return 'bool'
    case 'ByteProperty':
      return n.params.length && param(n) !== 'None' ? `TEnumAsByte<${param(n)}>` : 'uint8'
    case 'Int8Property':
      return 'int8'
    case 'Int16Property':
      return 'int16'
    case 'IntProperty':
      return 'int32'
    case 'Int64Property':
      return 'int64'
    case 'UInt16Property':
      return 'uint16'
    case 'UInt32Property':
      return 'uint32'
    case 'UInt64Property':
      return 'uint64'
    case 'FloatProperty':
      return 'float'
    case 'DoubleProperty':
      return 'double'
    case 'StrProperty':
      return 'FString'
    case 'NameProperty':
      return 'FName'
    case 'TextProperty':
      return 'FText'
    case 'EnumProperty':
      return param(n) || 'enum'
    case 'StructProperty':
      return `F${param(n)}`
    case 'ObjectProperty':
    case 'WeakObjectProperty':
    case 'LazyObjectProperty':
      return `${param(n) || 'Object'}*`
    case 'ClassProperty':
      return `TSubclassOf<${param(n, 1) || param(n) || 'Object'}>`
    case 'SoftObjectProperty':
      return `TSoftObjectPtr<${param(n) || 'Object'}>`
    case 'SoftClassProperty':
      return `TSoftClassPtr<${param(n) || 'Object'}>`
    case 'InterfaceProperty':
      return `TScriptInterface<${param(n) || 'Interface'}>`
    case 'ArrayProperty':
      return `TArray<${n.params[0] ? cppType(n.params[0]) : '?'}>`
    case 'SetProperty':
      return `TSet<${n.params[0] ? cppType(n.params[0]) : '?'}>`
    case 'MapProperty':
      return `TMap<${n.params[0] ? cppType(n.params[0]) : '?'}, ${n.params[1] ? cppType(n.params[1]) : '?'}>`
    case 'OptionalProperty':
      return `TOptional<${n.params[0] ? cppType(n.params[0]) : '?'}>`
    default:
      return n.name.replace(/Property$/, '')
  }
}
