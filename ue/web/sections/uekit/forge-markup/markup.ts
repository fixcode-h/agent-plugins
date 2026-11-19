import { normalizeKey } from '../../../../shared/forge-doc/keys.ts'
import type { PathSeg } from '../../../../shared/forge-doc/locate.ts'
import { HEAD } from '../../../../shared/forge-doc/sections.ts'
import { styleNames } from '../../../../shared/forge-doc/styles.ts'

/**
 * 标记视图的模型（设计稿 4.2 第 1 条）：把一份 AssetForge 配置换成类似 XAML 的标签树，只读、不存盘。
 * - 节点 `{class, name, props, slot, children}` → `<Button Name="Go" Style="NavButton" Text="商店" Slot.Padding="8, 0, 8, 0">`，
 *   children 嵌套；`ref` 子界面 → `<SubWidget Ref="pages/Shop">`；props 原样当属性，slot 加 `Slot.` 前缀（像 XAML 的附加属性）。
 * - 顶层 `styles` 放最前一段 `<Styles>`，`animations` 放最后一段 `<Animations>`（关键帧两种写法都认，压成一行）。
 * - 认不出是节点的对象（别的 kind 的字段、DataTable 的行）按通用规则：标量当属性，对象和数组当子标签。
 * 样式不在这里展开：标签上写的是配置里写的（`Style="NavButton"`），人看的就是自己写的那份。
 * 纯函数，不碰 React，单测直接引。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export interface MarkAttr {
  name: string
  /** 显示的值；flag 时没有值（布尔 true 写成 `IsVariable` 这样的光属性名） */
  text: string
  /** 值是字符串（加引号显示）还是数字 / 枚举 / 结构体 */
  str?: boolean
  flag?: boolean
  /** 颜色值：CSS 颜色，画一个色块 */
  swatch?: string
  /** 压成一行时截短了：完整的值（悬停看） */
  full?: string
  path: PathSeg[]
}

export interface MarkNode {
  id: string
  tag: string
  attrs: MarkAttr[]
  children: MarkNode[]
  path: PathSeg[]
  /** 配置里这个节点的 "//" 说明：显示成标签前的一行注释 */
  note?: string
  /** 段落标签（Styles、Animations 这类配置里没有对应节点的） */
  section?: boolean
  /** 这个节点是从哪个片段文件 include 进来的（相对配置根） */
  fragment?: string
}

/** 一个值在属性里最多显示这么多字，多的截掉、悬停看全 */
const MAX_TEXT = 72
/** 节点身上不当属性显示的字段：结构字段另有去处 */
const NODE_FIELDS = new Set(['class', 'name', 'ref', 'style', 'props', 'slot', 'children', '//'])
const DOC_FIELDS = new Set(['//', 'kind', 'root', 'styles', 'animations'])

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round = (n: number) => String(Math.round(n * 10000) / 10000)

/** 线性颜色 → 显示用 sRGB（UE 的 FLinearColor 是线性的，直接当 CSS rgb 会偏暗） */
function srgb(c: number) {
  const x = Math.min(1, Math.max(0, c))
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
  return Math.round(v * 255)
}

/** 认颜色：{R,G,B[,A]}（线性）、{SpecifiedColor: {...}}（FSlateColor）、"#RRGGBB[AA]" */
export function colorOf(v: unknown): { css: string; text: string } | undefined {
  if (typeof v === 'string' && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return { css: v, text: v }
  if (!isObj(v)) return undefined
  if (isObj(v.SpecifiedColor) && Object.keys(v).every((k) => k === 'SpecifiedColor' || k === 'ColorUseRule'))
    return colorOf(v.SpecifiedColor)
  const keys = Object.keys(v)
  if (!num(v.R) || !num(v.G) || !num(v.B) || !keys.every((k) => ['R', 'G', 'B', 'A'].includes(k))) return undefined
  const a = num(v.A) ? v.A : 1
  return {
    css: `rgba(${srgb(v.R)}, ${srgb(v.G)}, ${srgb(v.B)}, ${Math.min(1, Math.max(0, a))})`,
    text: [v.R, v.G, v.B, a].map(round).join(', '),
  }
}

/** 结构体 / 数组压成一行：边距 `8, 0, 8, 0`、向量 `(1, 2)`，其余 `{Size=16 Typeface=Bold}` */
export function inline(v: unknown): string {
  if (v === null) return 'null'
  if (num(v)) return round(v)
  if (typeof v !== 'object') return String(v)
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`
  const o = v as Obj
  const c = colorOf(o)
  if (c) return `(${c.text})`
  const keys = Object.keys(o)
  const all = (names: string[]) => keys.length === names.length && names.every((k) => num(o[k]))
  if (all(['Left', 'Top', 'Right', 'Bottom']))
    return ['Left', 'Top', 'Right', 'Bottom'].map((k) => inline(o[k])).join(', ')
  if (all(['X', 'Y'])) return `(${inline(o.X)}, ${inline(o.Y)})`
  if (all(['X', 'Y', 'Z'])) return `(${inline(o.X)}, ${inline(o.Y)}, ${inline(o.Z)})`
  return `{${keys.map((k) => `${k}=${inline(o[k])}`).join(' ')}}`
}

function attr(name: string, v: unknown, path: PathSeg[]): MarkAttr {
  if (v === true) return { name, text: '', flag: true, path }
  const c = colorOf(v)
  if (c) return { name, text: c.text, swatch: c.css, path }
  const text = typeof v === 'string' ? v : inline(v)
  const cut = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text
  return { name, text: cut, ...(typeof v === 'string' && { str: true }), ...(cut !== text && { full: text }), path }
}

/** 看起来是不是配置节点：有 class / ref / children 才算（DataTable 的行、别的字段走通用规则） */
const isNode = (v: unknown): v is Obj =>
  isObj(v) && (typeof v.class === 'string' || typeof v.ref === 'string' || Array.isArray(v.children))

const noteOf = (v: Obj) => (typeof v['//'] === 'string' && v['//'] ? v['//'] : undefined)

function nodeMark(n: Obj, path: PathSeg[]): MarkNode {
  const attrs: MarkAttr[] = []
  if (typeof n.name === 'string') attrs.push(attr('Name', n.name, [...path, 'name']))
  if (typeof n.ref === 'string') attrs.push(attr('Ref', n.ref, [...path, 'ref']))
  const st = styleNames(n)
  if (st.length) attrs.push({ name: 'Style', text: st.join(', '), str: true, path: [...path, 'style'] })
  for (const [k, v] of Object.entries(n)) if (!NODE_FIELDS.has(k)) attrs.push(attr(k, v, [...path, k]))
  if (isObj(n.props)) for (const [k, v] of Object.entries(n.props)) attrs.push(attr(k, v, [...path, 'props', k]))
  if (isObj(n.slot)) for (const [k, v] of Object.entries(n.slot)) attrs.push(attr(`Slot.${k}`, v, [...path, 'slot', k]))
  const kids = Array.isArray(n.children) ? n.children : []
  const tag = typeof n.ref === 'string' && typeof n.class !== 'string' ? 'SubWidget' : String(n.class ?? 'Node')
  return {
    id: path.join('/'),
    tag,
    attrs,
    children: kids.map((c, i) => anyMark('Item', c, [...path, 'children', i])),
    path,
    note: noteOf(n),
  }
}

/** 通用：节点走 nodeMark；别的对象标量当属性、对象数组当子标签；数组的每一项叫 Item */
function anyMark(tag: string, v: unknown, path: PathSeg[]): MarkNode {
  if (isNode(v)) return nodeMark(v, path)
  const id = path.join('/')
  if (Array.isArray(v))
    return { id, tag, attrs: [], children: v.map((x, i) => anyMark('Item', x, [...path, i])), path, section: true }
  if (!isObj(v)) return { id, tag, attrs: [attr('Value', v, path)], children: [], path }
  const attrs: MarkAttr[] = []
  const children: MarkNode[] = []
  for (const [k, x] of Object.entries(v)) {
    if (k === '//') continue
    // 颜色、边距这类小结构体还是当属性（压成一行），大对象和数组才当子标签
    if ((isObj(x) && (colorOf(x) || Object.keys(x).length <= 4) && !isNode(x)) || !(isObj(x) || Array.isArray(x)))
      attrs.push(attr(k, x, [...path, k]))
    else children.push(anyMark(k, x, [...path, k]))
  }
  return { id, tag, attrs, children, path, note: noteOf(v) }
}

/** 一条轨道的关键帧压成一个属性：`0→0 · 0.3→0.85 cubic · 0.45→1`（简写和对象写法显示一样） */
function keysAttr(keys: unknown, path: PathSeg[]): MarkAttr {
  const list = (Array.isArray(keys) ? keys : []).map(normalizeKey)
  const text = list
    .map((k) => (k ? `${round(k.time)}→${round(k.value)}${k.interp ? ` ${k.interp}` : ''}` : '?'))
    .join(' · ')
  return attr('Keys', text, path)
}

function animationsMark(anims: unknown[]): MarkNode {
  const path: PathSeg[] = ['animations']
  return {
    id: 'animations',
    tag: 'Animations',
    attrs: [],
    path,
    section: true,
    children: anims.map((a, i) => {
      const ap = [...path, i]
      if (!isObj(a)) return anyMark('Animation', a, ap)
      const tracks = Array.isArray(a.tracks) ? a.tracks : []
      const extra = Object.entries(a).filter(([k]) => !['name', 'tracks', '//'].includes(k))
      return {
        id: ap.join('/'),
        tag: 'Animation',
        path: ap,
        note: noteOf(a),
        attrs: [attr('Name', a.name ?? '', [...ap, 'name']), ...extra.map(([k, v]) => attr(k, v, [...ap, k]))],
        children: tracks.map((t, j) => {
          const tp = [...ap, 'tracks', j]
          if (!isObj(t)) return anyMark('Track', t, tp)
          return {
            id: tp.join('/'),
            tag: 'Track',
            path: tp,
            children: [],
            attrs: [
              attr('Target', t.target ?? '', [...tp, 'target']),
              attr('Channel', t.channel ?? '', [...tp, 'channel']),
              keysAttr(t.keys, [...tp, 'keys']),
            ],
          }
        }),
      }
    }),
  }
}

function stylesMark(styles: Obj): MarkNode {
  const path: PathSeg[] = ['styles']
  return {
    id: 'styles',
    tag: 'Styles',
    attrs: [],
    path,
    section: true,
    children: Object.entries(styles).map(([name, s]) => {
      const sp = [...path, name]
      const o = isObj(s) ? s : {}
      const attrs = [{ name: 'Name', text: name, str: true, path: sp } as MarkAttr]
      if (isObj(o.props)) for (const [k, v] of Object.entries(o.props)) attrs.push(attr(k, v, [...sp, 'props', k]))
      if (isObj(o.slot))
        for (const [k, v] of Object.entries(o.slot)) attrs.push(attr(`Slot.${k}`, v, [...sp, 'slot', k]))
      return { id: sp.join('/'), tag: 'Style', attrs, children: [], path: sp, note: noteOf(o) }
    }),
  }
}

export interface MarkSection {
  /** 段 id：HEAD（头）、styles、root、animations 或别的顶层字段 */
  id: string
  /** 段里的顶层标签：头段是一个自闭合的 <Asset …>，styles 段是每个 <Style>，root 段是根节点，animations 段是每个 <Animation> */
  nodes: MarkNode[]
  /** 整段来自片段文件（段 include） */
  fragment?: string
}

/**
 * 整份（展开 include 之后的）配置 → 按段的标签：头段 `<Asset Kind=… Path=…/>`，然后 styles、root、其他字段、animations。
 * fragmentAt 给出某个位置来自哪个片段文件（节点 include 的节点、段 include 的段），标签上标出来
 */
export function buildSections(
  doc: unknown,
  ids: readonly string[],
  fragmentAt?: (path: PathSeg[]) => string | undefined,
): MarkSection[] {
  const d = isObj(doc) ? doc : {}
  const attrs: MarkAttr[] = []
  if (typeof d.kind === 'string') attrs.push(attr('Kind', d.kind, ['kind']))
  for (const [k, v] of Object.entries(d)) {
    if (DOC_FIELDS.has(k) || k === '$schema' || ids.includes(k)) continue
    attrs.push(attr(k === 'asset' ? 'Path' : k[0].toUpperCase() + k.slice(1), v, [k]))
  }
  const out: MarkSection[] = [
    { id: HEAD, nodes: [{ id: '', tag: 'Asset', attrs, children: [], path: [], note: noteOf(d) }] },
  ]
  const order = [
    ...ids.filter((k) => k in d),
    ...Object.keys(d).filter((k) => !ids.includes(k) && (k === 'styles' || k === 'root' || k === 'animations')),
  ]
  for (const k of order) {
    const v = d[k]
    let nodes: MarkNode[]
    if (k === 'styles' && isObj(v)) nodes = stylesMark(v).children
    else if (k === 'animations' && Array.isArray(v)) nodes = animationsMark(v).children
    else if (k === 'root') nodes = [anyMark('Root', v, ['root'])]
    else if (Array.isArray(v)) nodes = v.map((x, i) => anyMark('Item', x, [k, i]))
    else nodes = [anyMark(k, v, [k])]
    if (fragmentAt) for (const n of nodes) markFragments(n, fragmentAt, fragmentAt([k]))
    out.push({ id: k, nodes, ...(fragmentAt?.([k]) && { fragment: fragmentAt([k]) }) })
  }
  return out
}

/** 节点 include 展开出来的节点标上片段文件；整段都来自同一个片段时不重复标 */
function markFragments(n: MarkNode, at: (path: PathSeg[]) => string | undefined, inherited?: string) {
  const f = at(n.path)
  if (f && f !== inherited) n.fragment = f
  for (const c of n.children) markFragments(c, at, f ?? inherited)
}

/** 标签树里的节点数（规模大时默认只展开前几层） */
export function countMarks(n: MarkNode): number {
  return n.children.reduce((s, c) => s + countMarks(c), 1)
}
