import { setJsonAt } from '../forge-doc/edit.ts'
import type { PathSeg } from '../forge-doc/locate.ts'
import { applyStyles, normalizeField } from '../forge-doc/styles.ts'
import type { UmgKind, UmgPropDef } from './defaults.ts'
import { normalizeValue } from './values.ts'

/**
 * UMG 配置里一个控件节点的属性：显示的值从哪来（节点自己写的、样式给的、UE 默认值），改了以后往配置里写什么。
 * 规则照 UE 细节面板（用户 2026-11-20）：没写的显示默认值；改成和默认（有样式时是样式给的值）不一样才写进节点，
 * 改回去就从节点上删掉；结构体只改一个成员时只写那个成员（Font.Size），配置里是 "(Left=1,…)" 这类整串写法的才整体重写。
 * 纯函数，网页和单测共用。
 */
type Obj = Record<string, unknown>
export type Field = 'props' | 'slot'

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: string, b: string) => normalizeField(a) === normalizeField(b)
const keyIn = (o: Obj, k: string) => Object.keys(o).find((x) => same(x, k))

/** 按路径取值（字段名按导入的规则认） */
export function getIn(v: unknown, segs: readonly string[]): unknown {
  let cur = v
  for (const s of segs) {
    if (!isObj(cur)) return undefined
    const k = keyIn(cur, s)
    cur = k === undefined ? undefined : cur[k]
  }
  return cur
}

/** 按路径换一个值，返回新对象（中间缺的补空对象），原对象不动 */
export function setIn(v: unknown, segs: readonly string[], next: unknown): unknown {
  if (!segs.length) return next
  const o: Obj = isObj(v) ? { ...v } : {}
  const k = keyIn(o, segs[0]) ?? segs[0]
  o[k] = setIn(o[k], segs.slice(1), next)
  return o
}

/** 深合并：对象逐层合，标量和数组整体替换；保留 base 的顺序和拼法（显示按 UE 默认值表的顺序排） */
export function overlay(base: unknown, over: unknown): unknown {
  if (over === undefined) return base
  if (!isObj(base) || !isObj(over)) return over
  const out: Obj = { ...base }
  for (const [k, v] of Object.entries(over)) {
    const hit = keyIn(out, k) ?? k
    out[hit] = overlay(out[hit], v)
  }
  return out
}

/** 值相等：字段名按导入规则认，数字按显示精度比（数字框四舍五入到 6 位小数） */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    return ka.every((k) => {
      const kb = keyIn(b, k)
      return kb !== undefined && sameValue(a[k], b[kb])
    })
  }
  return a === b
}

/** 属性定义里按路径找（顶层按名字，往下按 members） */
export function defAt(defs: readonly UmgPropDef[], segs: readonly string[]): UmgPropDef | undefined {
  let list: readonly UmgPropDef[] | undefined = defs
  let hit: UmgPropDef | undefined
  for (const s of segs) {
    hit = list?.find((d) => same(d.name, s))
    if (!hit) return undefined
    list = hit.members
  }
  return hit
}

const isColor = (v: unknown) => isObj(v) && ['R', 'G', 'B'].every((k) => keyIn(v, k) !== undefined)
const flatNumbers = (v: unknown): v is Record<string, number> =>
  isObj(v) && Object.values(v).every((x) => typeof x === 'number')

/** 网页上的值换回配置的写法：原来是 "(R=1,…)" 整串的还写整串，FSlateColor 包回 SpecifiedColor */
export function denormalize(kind: UmgKind | undefined, next: unknown, before: unknown): unknown {
  if (typeof before === 'string' && /^\s*\(/.test(before) && flatNumbers(next))
    return `(${Object.entries(next)
      .map(([k, n]) => `${k}=${n}`)
      .join(',')})`
  const wrapped = isObj(before) && keyIn(before, 'SpecifiedColor') !== undefined
  if ((kind === 'slatecolor' || wrapped) && isColor(next)) {
    const rule = isObj(before) ? before[keyIn(before, 'ColorUseRule') ?? ''] : undefined
    return { SpecifiedColor: next, ColorUseRule: typeof rule === 'string' ? rule : 'UseColor_Specified' }
  }
  return next
}

export interface PropOrigin {
  /** 节点自己写了（结构体只写了一部分也算） */
  own: boolean
  /** 节点没写、来自这个样式 */
  style?: string
}

/** 一个节点的属性 / 插槽：节点自己写的、样式给的（不含节点自己的），和每个顶层字段来自哪 */
export function nodeLayers(node: unknown, styles: unknown, field: Field) {
  const n = isObj(node) ? node : {}
  const own = isObj(n[field]) ? (n[field] as Obj) : {}
  const styleOnly = applyStyles({ style: n.style }, styles)
  const fromStyle = (field === 'props' ? styleOnly.props : styleOnly.slot) ?? {}
  const styled = applyStyles(n, styles)
  const from = field === 'props' ? styled.propFrom : styled.slotFrom
  const origin = (key: string): PropOrigin => ({
    own: keyIn(own, key) !== undefined,
    style: keyIn(own, key) === undefined ? from[normalizeField(key)] : undefined,
  })
  return { own, fromStyle, origin }
}

/** 一个顶层字段的「基准」：UE 默认值上叠样式给的（节点不写时显示的就是它） */
export function baseOf(def: UmgPropDef | undefined, styleValue: unknown) {
  return overlay(normalizeValue(def?.def), normalizeValue(styleValue))
}

/** 显示的值：基准上叠节点自己写的 */
export function effectiveOf(def: UmgPropDef | undefined, styleValue: unknown, ownValue: unknown) {
  return overlay(baseOf(def, styleValue), normalizeValue(ownValue))
}

export interface EditPlan {
  /** 相对节点的 props / slot：要写（或删）的字段路径 */
  segs: string[]
  /** undefined = 从配置里删掉 */
  value: unknown
}

/**
 * 细节面板改了 field 下 segs（[顶层属性, 成员…]）的值成 next：算出往节点上写什么。
 * 返回 null 是不用改配置（改成的值和没写时一样，节点上本来也没写）
 */
export function planEdit(a: {
  node: unknown
  styles: unknown
  defs: readonly UmgPropDef[]
  field: Field
  segs: readonly string[]
  next: unknown
}): EditPlan | null {
  const { own, fromStyle } = nodeLayers(a.node, a.styles, a.field)
  const [top, ...rest] = a.segs
  const topDef = defAt(a.defs, [top])
  const base = baseOf(topDef, getIn(fromStyle, [top]))
  const ownTop = getIn(own, [top])
  // 结构体成员：配置里那一层是整串写法（"(Left=1,…)"）或别的非对象，没法只写一个成员，整个字段重写
  const whole = rest.some((_, i) => {
    const v = getIn(own, a.segs.slice(0, i + 1))
    return v !== undefined && !isObj(v)
  })
  if (whole || !rest.length) {
    const cur = overlay(base, normalizeValue(ownTop))
    const nextTop = setIn(cur, rest, a.next)
    if (sameValue(nextTop, base)) return ownTop === undefined ? null : { segs: [top], value: undefined }
    if (!rest.length && ownTop !== undefined && sameValue(normalizeValue(ownTop), nextTop)) return null
    return { segs: [top], value: denormalize(topDef?.kind, nextTop, ownTop) }
  }
  const baseAt = getIn(base, rest)
  const ownAt = getIn(own, a.segs)
  if (sameValue(a.next, baseAt)) return ownAt === undefined ? null : { segs: [...a.segs], value: undefined }
  if (ownAt !== undefined && sameValue(normalizeValue(ownAt), a.next)) return null
  return { segs: [...a.segs], value: denormalize(defAt(a.defs, a.segs)?.kind, a.next, ownAt) }
}

/**
 * 把改动落到配置原文上：nodePath 是节点在这份文件里的路径（主文件或 include 的片段文件，sourceOf 查出来的），
 * 只动 field 下那一个字段；删到 props / slot 空了连它一起删，节点本身不动
 */
export function applyPlan(text: string, nodePath: readonly PathSeg[], field: Field, plan: EditPlan) {
  return setJsonAt(text, [...nodePath, field, ...plan.segs], plan.value, { pruneEmpty: nodePath.length })
}
