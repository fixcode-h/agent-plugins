/**
 * UMG 布局的数据形状（和 UELink 的 umg.design / umg.render / umg.anims 约定，设计稿第 5 节），
 * 以及网页里统一用的控件树节点（UE 回的设计时控件树、AssetForge 配置的节点树都换成 WNode）。纯类型和小函数，单测直接 import。
 */

/** umg.design 回的一个控件 */
export interface DesignNode {
  name: string
  class: string
  /** 控件模板的对象路径，可以直接交给 props 读细节 */
  path: string
  var?: boolean
  visibility?: string
  /** 插槽：UE 回类名（VerticalBoxSlot）或插槽属性 */
  slot?: string | Record<string, unknown>
  /** WidgetSwitcher 当前页的下标 */
  active?: number
  /** 子界面（用户控件）：asset 是它的控件蓝图 */
  user?: boolean
  asset?: string
  children: DesignNode[]
  /** 子控件太多被截断 */
  truncated?: boolean
}

export interface UmgDesign {
  asset: string
  parent?: string
  root: DesignNode
  animations: number
}

/** umg.render 回的控件矩形（相对屏幕，像素） */
export interface WidgetRect {
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface UmgRender {
  /** 本机 PNG 的绝对路径（Saved/UELink/preview/ 下） */
  file: string
  width: number
  height: number
  widgets: WidgetRect[]
  ms: number
  note?: string
}

/** 网页里统一的控件树节点：key 是从根起的名字路径（Root/Shell/Main），和动画轨道的 target 同一种写法 */
export interface WNode {
  key: string
  name: string
  cls: string
  /** UE 里的对象路径（从 umg.design 来才有）：右栏按它读真实细节 */
  path?: string
  isVar?: boolean
  visibility?: string
  /** 插槽的类（UE 回的）；配置里没有，按父控件推 */
  slotClass?: string
  active?: number
  user?: boolean
  asset?: string
  /** 配置里的属性和插槽属性（近似预览、只读细节用）；UE 回的树没有 */
  props?: Record<string, unknown>
  slot?: Record<string, unknown>
  children: WNode[]
  truncated?: boolean
}

/** /Script/UMG.TextBlock、TextBlock_C 这类写法都取短类名 */
export const shortCls = (c?: string) => (c ?? '').split(/[./]/).pop()?.replace(/_C$/, '') ?? ''

/** 可见性写法统一：ESlateVisibility::Collapsed、Collapsed 都认 */
export const visOf = (v: unknown) => (typeof v === 'string' ? v.split(':').pop() : undefined)
export const isCollapsed = (n: WNode) => n.visibility === 'Collapsed'
export const isHidden = (n: WNode) => n.visibility === 'Collapsed' || n.visibility === 'Hidden'

export function fromDesign(n: DesignNode, parentKey = ''): WNode {
  const key = parentKey ? `${parentKey}/${n.name}` : n.name
  return {
    key,
    name: n.name,
    cls: shortCls(n.class),
    path: n.path,
    isVar: n.var,
    visibility: visOf(n.visibility),
    slotClass: typeof n.slot === 'string' ? shortCls(n.slot) : undefined,
    slot: n.slot && typeof n.slot === 'object' ? n.slot : undefined,
    active: n.active,
    user: n.user,
    asset: n.asset,
    truncated: n.truncated,
    children: (n.children ?? []).map((c) => fromDesign(c, key)),
  }
}

/** 摊平成「key → 节点」和「key → 父节点」：树和预览联动、命中、找动画目标都要 */
export function indexTree(root?: WNode) {
  const byKey = new Map<string, WNode>()
  const parent = new Map<string, WNode>()
  const byName = new Map<string, WNode>()
  const walk = (n: WNode) => {
    byKey.set(n.key, n)
    if (!byName.has(n.name)) byName.set(n.name, n)
    for (const c of n.children) {
      parent.set(c.key, n)
      walk(c)
    }
  }
  if (root) walk(root)
  return { byKey, parent, byName }
}

/** 动画轨道的 target、渲染回的控件名 → 树上的节点：先按完整路径找，找不到按最后一段名字找（控件名在 WidgetTree 里唯一） */
export function resolveTarget(idx: ReturnType<typeof indexTree>, target: string) {
  return idx.byKey.get(target) ?? idx.byName.get(target.split('/').pop() ?? target)
}
