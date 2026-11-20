import type { GNode, GPin } from './graph.ts'
import { UE_PIN, type UePinKind, type UeTitleKind } from './ue-theme.ts'

/**
 * 节点图照 UE 蓝图编辑器的外观要用到的纯函数：引脚类型 → 颜色和图标、节点 → 外形和标题色、
 * 节点尺寸估算、UE 的连线曲线、引脚显示名。颜色值在 ue-theme.ts，单测在 ue-style.test.ts
 */

/**
 * UE 的类型文字（UEdGraphSchema_K2::TypeToText：Boolean、Actor Object Reference、Vector Structure、
 * Array of Integers…）→ 引脚配色。容器先剥掉「Array of / Set of / Map of」按元素算；复数（Integers）也认
 */
export function pinKind(type: string): UePinKind {
  if (type === 'exec') return 'exec'
  let t = type.trim().toLowerCase()
  const m = /^(array|set|map) of (.+?)( to .+)?$/.exec(t)
  if (m) t = m[2]
  if (/delegate|dispatcher/.test(t)) return 'delegate'
  if (/soft object references?$/.test(t)) return 'softObject'
  if (/soft class references?$/.test(t)) return 'softClass'
  if (/class references?$/.test(t)) return 'class'
  if (/object references?$/.test(t)) return 'object'
  if (/\binterfaces?$/.test(t)) return 'interface'
  if (/^booleans?$/.test(t)) return 'bool'
  if (/^integer ?64s?$|^int64s?$/.test(t)) return 'int64'
  if (/^integers?$/.test(t)) return 'int'
  if (/\benum(eration)?s?$/.test(t)) return 'enum'
  if (/^bytes?$/.test(t)) return 'byte'
  if (/^(floats?|doubles?|reals?)\b/.test(t)) return 'float'
  if (/^strings?$/.test(t)) return 'string'
  if (/^names?$/.test(t)) return 'name'
  if (/^texts?$/.test(t)) return 'text'
  // 只有 FVector 用金黄色；Vector 2D、Vector 4 在 UE 里是普通结构体的深蓝
  if (/^vectors?( structures?)?$/.test(t)) return 'vector'
  if (/^rotators?( structures?)?$/.test(t)) return 'rotator'
  if (/^transforms?( structures?)?$/.test(t)) return 'transform'
  if (/structures?$|\bstructs?$/.test(t)) return 'struct'
  if (/wildcard/.test(t)) return 'wildcard'
  return 'default'
}

export const pinColor = (type: string) => UE_PIN[pinKind(type)]

/** 容器引脚的图标：数组是小方格，集合、映射 UE 各有图标，这里都按方格画（只差在格子排法） */
export function pinContainer(type: string): 'array' | 'set' | 'map' | undefined {
  const m = /^(array|set|map) of /i.exec(type.trim())
  return m ? (m[1].toLowerCase() as 'array' | 'set' | 'map') : undefined
}

/**
 * 引脚显示名，照 UE 的 FName::NameToDisplayString：bool 去掉前缀 b、驼峰拆成单词（NewRotation → New Rotation），
 * self 显示成「目标」（返回 null，由组件按界面语言写），执行引脚 execute / then 不写名字（返回空串）
 */
export function pinLabel(pin: GPin): string | null {
  if (pin.type === 'exec') return /^(execute|then|exec)$/i.test(pin.name) ? '' : spaced(pin.name)
  if (pin.name === 'self') return null
  const bare = pinKind(pin.type) === 'bool' && /^b[A-Z]/.test(pin.name) ? pin.name.slice(1) : pin.name
  return spaced(bare)
}

function spaced(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 默认值框里的字：对象路径只留名字，0.000000 这类浮点写短，bool 由组件画成勾选框 */
export function defaultText(value: string): string {
  const v = value.trim()
  if (/^\/(Game|Script|Engine)\//.test(v)) return v.split(/[./:]/).pop() ?? v
  return v.replace(/(-?\d+\.\d*?)0+\b/g, (_, n: string) => (n.endsWith('.') ? `${n}0` : n))
}

/**
 * 节点外形：
 * - full：普通节点，有标题条（事件、函数调用、纯函数、宏、流程控制、Cast、函数入口出口…）
 * - var：变量 Get / Set，没有标题条的紧凑胶囊（Set 中间写「SET」）
 * - dot：类型转换节点（Conv_*），小圆点，只有一进一出
 * - knot：转接点（Reroute），只是线上的一个点
 */
export type NodeLook = 'full' | 'var' | 'dot' | 'knot'

export type NodeIcon = 'event' | 'function' | 'macro' | 'flow' | 'cast' | 'entry' | 'none'

export interface NodeStyle {
  look: NodeLook
  title: UeTitleKind
  icon: NodeIcon
  /** 标题下的副标题：自定义事件写「Custom Event」，有 self 引脚的调用写「Target is X」 */
  subtitle?: { kind: 'custom' } | { kind: 'target'; name: string }
}

const FLOW_TITLES = /^(branch|sequence|do ?once|do ?n|flip ?flop|gate|multi ?gate|select|switch on .+)$/i

const hasExec = (n: GNode) => n.pins.some((p) => p.type === 'exec')

/** 「Target is X」：self 引脚的类型去掉「Object Reference」；蓝图自己（self 默认值）不写 */
function targetName(n: GNode): string | undefined {
  const self = n.pins.find((p) => p.name === 'self' && p.dir === 'in')
  if (!self) return undefined
  const name = self.type.replace(/\s*(Object|Class|Soft Object) References?$/i, '').trim()
  return name || undefined
}

export function nodeStyle(n: GNode): NodeStyle {
  if (/^reroute( node)?$/i.test(n.title)) return { look: 'knot', title: 'other', icon: 'none' }
  switch (n.kind) {
    case 'event':
      return { look: 'full', title: 'event', icon: 'event' }
    case 'custom_event':
      return { look: 'full', title: 'event', icon: 'event', subtitle: { kind: 'custom' } }
    case 'entry':
    case 'return':
      return { look: 'full', title: 'terminator', icon: 'entry' }
    case 'get':
    case 'set':
      return { look: 'var', title: 'other', icon: 'none' }
    case 'branch':
      return { look: 'full', title: 'flow', icon: 'flow' }
    case 'macro':
      return { look: 'full', title: 'macro', icon: 'macro' }
    case 'cast':
      return { look: 'full', title: 'cast', icon: 'cast' }
    case 'call': {
      // 类型转换（KismetStringLibrary.Conv_IntToString 这类）在 UE 里是个小圆点
      if (/(^|\.)Conv_/.test(n.member ?? '') && !hasExec(n)) return { look: 'dot', title: 'pure', icon: 'none' }
      const target = targetName(n)
      return {
        look: 'full',
        title: hasExec(n) ? 'call' : 'pure',
        icon: 'function',
        ...(target ? { subtitle: { kind: 'target' as const, name: target } } : {}),
      }
    }
    default:
      if (FLOW_TITLES.test(n.title)) return { look: 'full', title: 'flow', icon: 'flow' }
      return { look: 'full', title: hasExec(n) ? 'call' : 'other', icon: 'function' }
  }
}

/** 尺寸常量：标题条、副标题、一行引脚、变量节点 SET 字样的高度 */
export const HEAD_H = 28
export const SUB_H = 14
export const ROW_H = 22
export const SET_H = 16
const PAD_B = 8
const MIN_W = 112
const MAX_W = 320
/** 估字宽（UE 的 Roboto 10pt 在 1 倍缩放下约这么宽），够让节点宽窄贴近 UE，不追求精确 */
const CH = 6.6

const textW = (s: string) => Math.ceil(s.length * CH)

/** 一侧引脚占的宽：图标 + 名字 + 默认值框 */
function sideW(p: GPin | undefined): number {
  if (!p) return 0
  const label = pinLabel(p) ?? 'Target'
  const def =
    p.dir === 'in' && p.default !== undefined && !p.to?.length ? Math.min(textW(defaultText(p.default)), 80) + 14 : 0
  return 22 + textW(label) + def
}

/**
 * 节点在画布上的宽高（自动排布和 UE 坐标模式都用）：按外形和文字长度估，宽度限在 112–320。
 * rows 是 pinRows 的结果（每行左右各一个引脚）
 */
export function nodeSize(n: GNode, rows: { in?: GPin; out?: GPin }[]): { w: number; h: number } {
  const st = nodeStyle(n)
  if (st.look === 'knot') return { w: 24, h: 16 }
  if (st.look === 'dot') return { w: 44, h: 24 }
  const pinW = Math.max(0, ...rows.map((r) => sideW(r.in) + sideW(r.out) + (r.in && r.out ? 20 : 0)))
  if (st.look === 'var') {
    const isSet = n.kind === 'set'
    // Get 节点左边写变量的显示名（和 GraphNode 一致），右边是引脚图标
    const v = n.pins.find((p) => p.type !== 'exec' && p.name !== 'self')
    const label = (v && pinLabel(v)) || n.member || n.title
    const w = Math.max(isSet ? 96 : 64, pinW + 16, isSet ? 0 : textW(label) + 48)
    return { w: Math.min(MAX_W, w), h: (isSet ? SET_H : 0) + Math.max(rows.length, 1) * ROW_H + 8 }
  }
  const sub = st.subtitle ? SUB_H : 0
  const titleW = 34 + textW(n.title) + 14
  const w = Math.min(MAX_W, Math.max(MIN_W, titleW, pinW + 16))
  return { w, h: HEAD_H + sub + Math.max(rows.length, 1) * ROW_H + PAD_B }
}

/**
 * UE 的连线曲线（FConnectionDrawingPolicy::ComputeSplineTangent 的默认参数）：从输出右侧水平出、输入左侧水平进；
 * 往前连时切线长取水平、垂直距离（各封顶 1000）之和，往回连时水平距离放大 3 倍、垂直 1.5 倍（各封顶 200），
 * 线绕一个弯回来。Hermite 切线换成三次贝塞尔的控制点：P1 = P0 + T/3，P2 = P3 − T/3。
 * 返回 [SVG path, 中点 x, 中点 y]
 */
export function wirePath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const dx = tx - sx
  const dy = Math.abs(ty - sy)
  const fwd = dx >= 0
  const tan = fwd
    ? Math.min(Math.abs(dx), 1000) + Math.min(dy, 1000)
    : Math.min(Math.abs(dx), 200) * 3 + Math.min(dy, 200) * 1.5
  const c = tan / 3
  const r = (v: number) => Math.round(v * 10) / 10
  const path = `M${r(sx)},${r(sy)} C${r(sx + c)},${r(sy)} ${r(tx - c)},${r(ty)} ${r(tx)},${r(ty)}`
  // 三次贝塞尔 t=0.5 的点：(P0 + 3P1 + 3P2 + P3) / 8
  return [path, r((sx + 3 * (sx + c) + 3 * (tx - c) + tx) / 8), r((sy + ty) / 2)]
}
