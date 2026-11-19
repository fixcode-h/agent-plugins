import { show } from '../../../api.ts'

/**
 * 结构体成员（单测 struct.test.ts）。UELink 没有专门读结构体的接口，这里读 UserDefinedStruct 编辑器数据里的
 * VariablesDescriptions（get EditorData.VariablesDescriptions）：每个成员的变量名、显示名、引脚类型、容器、默认值、提示。
 * 引擎的 JSON 转换把字段首字母改成小写（varName、friendlyName），两种都认
 */
export interface Member {
  /** 显示名（FriendlyName）；没有时用变量名去掉 _2_GUID 后缀 */
  name: string
  /** 变量名（ItemId_2_8F3A…），存档和反射里用的是它 */
  varName: string
  type: string
  /** 引脚分类（bool、int、real、struct…），配颜色用 */
  category: string
  defaultValue: string
  tooltip: string
  container: string
  flags: { saveGame: boolean; dontEditOnInstance: boolean; multiLine: boolean }
  raw: Record<string, unknown>
}

function get(o: Record<string, unknown>, name: string): unknown {
  if (name in o) return o[name]
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase())
  return k === undefined ? undefined : o[k]
}
const str = (o: Record<string, unknown>, name: string) => show(get(o, name) ?? '')

/** 变量名去掉 UE 加的唯一后缀：Price_12_0A1B2C3D4E5F60718293A4B5C6D7E8F9 → Price */
export const stripVarName = (n: string) => n.replace(/_\d+_[0-9A-F]{32}$/i, '')

/** 路径或类名的最后一段：/Script/CoreUObject.LinearColor → LinearColor */
const shortObj = (s: string) => (s && s !== 'None' ? (s.split(/[./]/).pop() ?? s) : '')

/** 驼峰拆词：LinearColor → Linear Color、Texture2D → Texture 2D（照 UE 引脚类型的显示） */
const words = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')

/** 一个引脚类型的显示名（不含容器）：分类 + 子分类 + 子分类对象 */
export function pinLabel(category: string, sub: string, obj: string): string {
  const o = shortObj(obj)
  switch (category.toLowerCase()) {
    case 'bool':
      return 'Boolean'
    case 'byte':
      return o || 'Byte'
    case 'int':
      return 'Integer'
    case 'int64':
      return 'Integer64'
    case 'real':
    case 'float':
    case 'double':
      return 'Float'
    case 'name':
      return 'Name'
    case 'string':
      return 'String'
    case 'text':
      return 'Text'
    case 'enum':
      return o || 'Enum'
    case 'struct':
      return o ? words(o) : 'Struct'
    case 'object':
      return o ? `${words(o)}` : 'Object'
    case 'softobject':
      return o ? `${words(o)} (Soft)` : 'Object (Soft)'
    case 'class':
      return o ? `${words(o)} Class` : 'Class'
    case 'softclass':
      return o ? `${words(o)} Class (Soft)` : 'Class (Soft)'
    case 'interface':
      return o ? words(o) : 'Interface'
    default:
      return category || sub || '?'
  }
}

/** 成员的完整类型：容器（Array of / Set of / Map of … to …）+ 引脚类型 */
export function typeLabel(m: Record<string, unknown>): string {
  const base = pinLabel(str(m, 'category'), str(m, 'subCategory'), str(m, 'subCategoryObject'))
  const container = str(m, 'containerType')
  if (/array/i.test(container)) return `Array of ${base}`
  if (/set/i.test(container)) return `Set of ${base}`
  if (/map/i.test(container)) {
    const v = get(m, 'pinValueType')
    const vo = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    const val = pinLabel(
      str(vo, 'terminalCategory'),
      str(vo, 'terminalSubCategory'),
      str(vo, 'terminalSubCategoryObject'),
    )
    return `Map of ${base} to ${val}`
  }
  return base
}

/** VariablesDescriptions 的值 → 成员列表；读不懂的条目跳过 */
export function parseMembers(raw: unknown): Member[] {
  if (!Array.isArray(raw)) return []
  const out: Member[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const varName = str(o, 'varName')
    const cur = str(o, 'currentDefaultValue')
    out.push({
      name: str(o, 'friendlyName') || stripVarName(varName),
      varName,
      type: typeLabel(o),
      category: str(o, 'category'),
      defaultValue: cur || str(o, 'defaultValue'),
      tooltip: str(o, 'toolTip'),
      container: str(o, 'containerType'),
      flags: {
        saveGame: get(o, 'bEnableSaveGame') === true,
        dontEditOnInstance: get(o, 'bDontEditOnInstance') === true,
        multiLine: get(o, 'bEnableMultiLineText') === true,
      },
      raw: o,
    })
  }
  return out
}

/** 默认值显示：空字符串写成 ""，空数组 []（和效果图一样，一眼看出「是空的」而不是「没读到」） */
export function shownDefault(m: Member) {
  if (m.defaultValue) return m.defaultValue
  if (/array|set|map/i.test(m.container)) return '[]'
  if (/^(string|text)$/i.test(m.category)) return '""'
  return ''
}

/** 配颜色用的类型词：对象、类引用按「object」配（类型显示名里不一定带 Object 字样，Texture 2D (Soft)） */
export const toneKey = (m: Member) => (/object|class|interface/i.test(m.category) ? 'object' : m.type)
