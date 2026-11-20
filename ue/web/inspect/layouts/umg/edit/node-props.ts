import { umgPropDefs, umgSlotDefs, type UmgKind, type UmgPropDef } from '../../../../../shared/umg-schema/defaults.ts'
import {
  defAt,
  effectiveOf,
  getIn,
  nodeLayers,
  sameValue,
  type Field,
} from '../../../../../shared/umg-schema/node-edit.ts'
import { normalizeValue } from '../../../../../shared/umg-schema/values.ts'
import { toDisplay, type MemberMeta, type Prop } from '../../../../details/model.ts'
import { categoryOf, categoryRank, shortClass } from '../../../../sections/uekit/forge-preview-props.ts'

/**
 * 按 AssetForge 配置画一个 UMG 控件的细节面板（资源还没生成、编辑器没开时）：
 * 属性表来自 UE 默认值表（shared/umg-schema），值是「默认值 ← 样式 ← 节点自己写的」叠出来的，
 * 配置里写了、表里没有的属性也列出来（没有默认值可比）。同时给细节面板的动作用的查询：某行是不是默认值、和默认值差不差。
 * 纯函数，单测直接 import；文案由调用方给（这里不碰界面语言）。
 */

const TYPE: Record<UmgKind, string> = {
  text: 'FText',
  string: 'FString',
  float: 'float',
  int: 'int32',
  bool: 'bool',
  enum: 'enum',
  color: 'FLinearColor',
  slatecolor: 'FSlateColor',
  margin: 'FMargin',
  vec2: 'FVector2D',
  ref: 'FString',
  struct: 'struct',
}

function memberMeta(d: UmgPropDef): MemberMeta {
  return {
    name: d.name,
    displayName: d.label,
    type: TYPE[d.kind],
    enum: d.enum,
    enumLabels: d.enumLabels,
    members: d.members?.map(memberMeta),
  }
}

/** 细节面板一行的路径（Slot.Padding.Left、Font.Size）→ 配置里的 field 和字段路径 */
export function splitPath(path: string): { field: Field; segs: string[] } {
  const parts = path.split('.')
  return parts[0] === 'Slot' && parts.length > 1
    ? { field: 'slot', segs: parts.slice(1) }
    : { field: 'props', segs: parts }
}

export interface NodeProps {
  props: Prop[]
  /** 这一行显示的是不是 UE 默认值（节点和样式都没写） */
  isDefault: (path: string) => boolean
  /** 和 UE 默认值不一样（行尾给「重置为默认」） */
  isChanged: (path: string) => boolean
  /** 这一行的 UE 默认值（重置用）；表外的属性没有 */
  defaultOf: (path: string) => unknown
  defs: Record<Field, UmgPropDef[]>
}

export function nodeProps(a: {
  /** 配置里的原始节点（没套样式） */
  node: unknown
  styles: unknown
  cls?: string
  parentClass?: string
  /** 「来自样式 {s}」这句（翻译好的） */
  fromStyle: (style: string) => string
  /** 只读时的原因；不给是能改 */
  readOnlyWhy?: string
}): NodeProps {
  const defs: Record<Field, UmgPropDef[]> = { props: umgPropDefs(a.cls), slot: umgSlotDefs(a.parentClass) }
  const layers = { props: nodeLayers(a.node, a.styles, 'props'), slot: nodeLayers(a.node, a.styles, 'slot') }
  const slotCat = a.parentClass ? `Slot (${shortClass(a.parentClass)}Slot)` : 'Slot'
  const ro = a.readOnlyWhy ? { readOnly: true, readOnlyWhy: a.readOnlyWhy } : {}

  const build = (field: Field): Prop[] => {
    const L = layers[field]
    const out: Prop[] = []
    const seen = new Set<string>()
    const row = (name: string, def: UmgPropDef | undefined, value: unknown): Prop => {
      const o = L.origin(name)
      const isBool = def?.kind === 'bool' || typeof value === 'boolean'
      return {
        name: field === 'slot' ? `Slot.${name}` : name,
        displayName: def?.label ?? toDisplay(name, isBool),
        type: def ? TYPE[def.kind] : typeof value === 'number' ? 'float' : isBool ? 'bool' : 'FString',
        category: field === 'slot' ? slotCat : (def?.category ?? categoryOf(a.cls, name)),
        value,
        edit: true,
        enum: def?.enum,
        enumLabels: def?.enumLabels,
        members: def?.members?.map(memberMeta),
        advanced: def?.advanced,
        ...(o.style ? { note: a.fromStyle(o.style) } : {}),
        ...ro,
      }
    }
    for (const d of defs[field]) {
      seen.add(d.name.toLowerCase())
      out.push(row(d.name, d, effectiveOf(d, getIn(L.fromStyle, [d.name]), getIn(L.own, [d.name]))))
    }
    // 配置写了、默认值表里没有的：照样列出来（样式给的也算）
    for (const src of [L.own, L.fromStyle])
      for (const [k, v] of Object.entries(src)) {
        if (seen.has(k.toLowerCase()) || defAt(defs[field], [k])) continue
        seen.add(k.toLowerCase())
        out.push(row(k, undefined, normalizeValue(getIn(L.own, [k]) ?? v)))
      }
    return out
  }

  const slot = build('slot')
  const props = build('props')
    .map((p, i) => ({ p, i }))
    .sort((x, y) => categoryRank(x.p.category!) - categoryRank(y.p.category!) || x.i - y.i)
    .map((x) => x.p)

  const defaultOf = (path: string) => {
    const { field, segs } = splitPath(path)
    const d = defAt(defs[field], [segs[0]])
    return d ? getIn(normalizeValue(d.def), segs.slice(1)) : undefined
  }
  const written = (path: string) => {
    const { field, segs } = splitPath(path)
    const L = layers[field]
    // 配置里那一层是整串写法（"(Left=1,…)"）：里面的成员也算写了
    for (let n = 1; n <= segs.length; n++) {
      const own = getIn(L.own, segs.slice(0, n))
      const st = getIn(L.fromStyle, segs.slice(0, n))
      if (n === segs.length ? own !== undefined || st !== undefined : typeof own === 'string' || typeof st === 'string')
        return true
    }
    return false
  }
  const valueOf = (path: string) => {
    const { field, segs } = splitPath(path)
    const L = layers[field]
    const d = defAt(defs[field], [segs[0]])
    const top = d
      ? effectiveOf(d, getIn(L.fromStyle, [segs[0]]), getIn(L.own, [segs[0]]))
      : normalizeValue(getIn(L.own, [segs[0]]) ?? getIn(L.fromStyle, [segs[0]]))
    return getIn(top, segs.slice(1))
  }
  return {
    props: [...slot, ...props],
    defs,
    isDefault: (path) => !written(path),
    isChanged: (path) => {
      const def = defaultOf(path)
      // 表外的属性没有默认值可比：节点自己写了就算改过（重置 = 从配置删掉）
      if (def === undefined) {
        const { field, segs } = splitPath(path)
        return getIn(layers[field].own, segs) !== undefined
      }
      return !sameValue(valueOf(path), def)
    },
    defaultOf,
  }
}
