/**
 * 材质 / 材质实例布局（设计稿第 3 节、效果图 B2 / B3）的纯数据部分：
 * - 材质：asset.describe 的内嵌子对象里挑出材质表达式（节点），参数节点单列；
 * - 材质实例：props 里的 Scalar / Vector / Texture ParameterValues 和静态开关读成「覆盖了哪些参数」。
 * UELink 没有导出材质图（连线、节点位置）的接口，这里只列节点，不画连线。单测在 material.test.ts
 */

export type ParamKind = 'scalar' | 'vector' | 'texture' | 'switch' | 'other'

export interface MatNode {
  path: string
  /** 子对象名（MaterialExpressionMultiply_3） */
  name: string
  class: string
  /** 类名去掉 MaterialExpression 前缀（Multiply、TextureSampleParameter2D） */
  type: string
  param: boolean
  kind: ParamKind
}

const PREFIX = 'MaterialExpression'

/** 参数表达式的种类：按类名认（ScalarParameter、VectorParameter、TextureSampleParameter2D、StaticSwitchParameter…） */
export function paramKind(cls: string): ParamKind {
  const c = cls.replace(PREFIX, '')
  if (/^StaticSwitch|^StaticBool|^StaticComponentMask/.test(c)) return 'switch'
  if (/Texture.*Parameter|Parameter.*Texture|^RuntimeVirtualTextureSampleParameter/.test(c)) return 'texture'
  if (/^VectorParameter|^ChannelMaskParameter|^DoubleVectorParameter/.test(c)) return 'vector'
  if (/^ScalarParameter|^CurveAtlasRowParameter/.test(c)) return 'scalar'
  return 'other'
}

const isParam = (cls: string) =>
  /Parameter/.test(cls.replace(PREFIX, '')) && !/^Collection/.test(cls.replace(PREFIX, ''))

/** 子对象里的材质表达式：参数在前（按种类、名字），其余按类型名；注释框（Comment）不算节点 */
export function materialNodes(subs: { path: string; name: string; class: string }[] | undefined): {
  params: MatNode[]
  nodes: MatNode[]
} {
  const all = (subs ?? [])
    .filter((s) => s.class.startsWith(PREFIX) && s.class !== `${PREFIX}Comment`)
    .map((s) => {
      const param = isParam(s.class)
      return {
        path: s.path,
        name: s.name.split(/[.:]/).pop() ?? s.name,
        class: s.class,
        type: s.class.slice(PREFIX.length) || s.class,
        param,
        kind: param ? paramKind(s.class) : ('other' as ParamKind),
      }
    })
  const order: ParamKind[] = ['vector', 'scalar', 'texture', 'switch', 'other']
  const params = all
    .filter((n) => n.param)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name))
  const nodes = all.filter((n) => !n.param).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  return { params, nodes }
}

/** 材质实例覆盖的一个参数 */
export interface Override {
  name: string
  kind: ParamKind
  /** 显示的值（标量数字、颜色 r g b a、贴图短名、开关 true / false） */
  value: string
  /** 颜色参数的 CSS 颜色（色块用） */
  color?: string
  /** 贴图参数的资源路径（能点开） */
  ref?: string
}

/** ParameterInfo 可能是对象 {Name}，也可能是 UE 文本 (Name="X",Association=GlobalParameter,Index=-1) */
export function paramName(info: unknown): string {
  if (info && typeof info === 'object') return String((info as Record<string, unknown>).Name ?? '')
  if (typeof info === 'string') {
    const m = /Name="?([^",)]+)"?/.exec(info)
    return m ? m[1] : info
  }
  return ''
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '?')

/** 线性颜色 {R,G,B,A}（或 UE 文本 (R=..,G=..)）读成数字 */
export function linearColor(v: unknown): [number, number, number, number] | undefined {
  let o: Record<string, unknown> | undefined
  if (v && typeof v === 'object') o = v as Record<string, unknown>
  else if (typeof v === 'string') {
    o = {}
    for (const m of v.matchAll(/([RGBA])=(-?[\d.eE+-]+)/g)) o[m[1]] = Number(m[2])
  }
  if (!o || o.R === undefined) return undefined
  return [num(o.R), num(o.G), num(o.B), o.A === undefined ? 1 : num(o.A)]
}

/** 线性颜色 → sRGB 的 CSS 颜色（色块只是示意：超过 1 的 HDR 值截到 1） */
export function cssColor([r, g, b]: [number, number, number, number]): string {
  const s = (c: number) => {
    const x = Math.min(1, Math.max(0, c))
    const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.round(v * 255)
  }
  return `rgb(${s(r)} ${s(g)} ${s(b)})`
}

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/**
 * 材质实例的 props → 覆盖了的参数（效果图 B3 勾选的那些）：标量、颜色、贴图、静态开关（只算 bOverride 的）。
 * 父材质里没被覆盖的参数这里没有（要 UELink 给出父材质的参数表才能列「继承自哪一层」，报告里列为缺的接口）
 */
export function instanceOverrides(map: Record<string, unknown> | undefined): Override[] {
  if (!map) return []
  const out: Override[] = []
  for (const s of list(map.ScalarParameterValues))
    out.push({ name: paramName(s.ParameterInfo), kind: 'scalar', value: fmt(num(s.ParameterValue)) })
  for (const s of list(map.VectorParameterValues)) {
    const c = linearColor(s.ParameterValue)
    out.push({
      name: paramName(s.ParameterInfo),
      kind: 'vector',
      value: c ? c.map(fmt).join(' ') : String(s.ParameterValue ?? ''),
      color: c && cssColor(c),
    })
  }
  for (const s of list(map.TextureParameterValues)) {
    const ref = typeof s.ParameterValue === 'string' ? s.ParameterValue : ''
    out.push({
      name: paramName(s.ParameterInfo),
      kind: 'texture',
      value: ref ? (ref.split(/[./]/).pop() ?? ref) : 'None',
      ref: ref && ref !== 'None' ? ref : undefined,
    })
  }
  const statics = (map.StaticParametersRuntime ?? map.StaticParameters) as Record<string, unknown> | undefined
  for (const s of list(statics?.StaticSwitchParameters).concat(list(map.StaticSwitchParameters)))
    if (s.bOverride !== false)
      out.push({ name: paramName(s.ParameterInfo), kind: 'switch', value: String(s.Value ?? s.bValue ?? '') })
  return out.filter((o) => o.name)
}

/** 材质参数节点自己的属性 → 参数名、分组、默认值（左栏显示） */
export function paramInfo(n: MatNode, map: Record<string, unknown> | undefined): Override & { group?: string } {
  const name = String(map?.ParameterName ?? n.name)
  const group = typeof map?.Group === 'string' && map.Group && map.Group !== 'None' ? map.Group : undefined
  const dv = map?.DefaultValue
  if (n.kind === 'vector') {
    const c = linearColor(dv)
    return { name, group, kind: n.kind, value: c ? c.map(fmt).join(' ') : '', color: c && cssColor(c) }
  }
  if (n.kind === 'texture') {
    const ref = typeof map?.Texture === 'string' ? map.Texture : ''
    return { name, group, kind: n.kind, value: ref ? (ref.split(/[./]/).pop() ?? ref) : '', ref: ref || undefined }
  }
  if (dv === undefined) return { name, group, kind: n.kind, value: '' }
  return { name, group, kind: n.kind, value: typeof dv === 'number' ? fmt(dv) : String(dv) }
}

/** 按分组排参数（没分组的叫 None 放最后，和 UE 一样） */
export function groupParams<T extends { group?: string; name: string }>(items: T[]): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const i of items) m.set(i.group ?? '', [...(m.get(i.group ?? '') ?? []), i])
  return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
}
