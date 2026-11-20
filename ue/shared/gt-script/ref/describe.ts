import { parsePropPath } from './prop-path.ts'
import { inObj, namedRef, refForm, shortClass } from './ref.ts'
import type { GtIdentItem, GtRef, GtRefLike } from './types.ts'

/**
 * 引用、部件、判断项的人话描述（列表视图、流程图节点、报告里看）：`WBP_Shop（标题 = 杂货铺，ShopId = 1001）`。
 * 数据层不依赖面板宿主：界面把自己的 t 传进来翻译这些词，服务端不传就是中文。
 * label：把属性路径换成人看的名字（界面可以按 gt.props 的显示名换，比如 @TxtTitle:text → 标题）；不给按路径本身缩短
 */
export interface DescribeOptions {
  objects?: unknown
  label?: (prop: string) => string | undefined
  t?: (zh: string) => string
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** op 的显示：符号能看懂的用符号，其余用词 */
function opWord(op: string | undefined, t: (zh: string) => string): string {
  switch (op) {
    case undefined:
    case 'eq':
    case 'is':
      return '='
    case 'ne':
    case 'isNot':
      return '≠'
    case 'gt':
      return '>'
    case 'gte':
      return '≥'
    case 'lt':
      return '<'
    case 'lte':
      return '≤'
    case 'contains':
      return t('包含')
    case 'startsWith':
      return t('开头是')
    case 'endsWith':
      return t('结尾是')
    case 'matches':
      return t('匹配')
    case 'in':
      return t('是其中之一')
    case 'between':
      return t('在区间')
    case 'key':
      return t('本地化键是')
    case 'near':
      return '≈'
    case 'classIs':
      return t('类是')
    case 'nameIs':
      return t('名字是')
    case 'has':
      return t('含有')
    case 'count':
      return t('个数')
    default:
      return op
  }
}

/** 不要 value 的 op 整句就是一个词 */
function bareOp(op: string | undefined, t: (zh: string) => string): string | undefined {
  switch (op) {
    case 'isNull':
      return t('为空')
    case 'notNull':
      return t('不为空')
    case 'empty':
      return t('是空的')
    case 'notEmpty':
      return t('不是空的')
    case 'visible':
      return t('看得见')
    case 'hidden':
      return t('看不见')
    default:
      return undefined
  }
}

/** 算出状态的显示名 */
function stateWord(state: string, t: (zh: string) => string): string {
  switch (state) {
    case 'exists':
      return t('存在')
    case 'onScreen':
      return t('在屏上')
    case 'shown':
      return t('显示')
    case 'enabled':
      return t('可用')
    case 'text':
      return t('文字')
    case 'textKey':
      return t('文字的本地化键')
    case 'count':
      return t('个数')
    case 'index':
      return t('序号')
    case 'selected':
      return t('选中')
    case 'checked':
      return t('勾选')
    case 'image':
      return t('图片')
    case 'hovered':
      return t('悬停')
    case 'focused':
      return t('有焦点')
    case 'pos':
      return t('位置')
    case 'size':
      return t('大小')
    case 'location':
      return t('世界位置')
    case 'distance':
      return t('距离')
    case 'hiddenInGame':
      return t('隐藏')
    case 'class':
      return t('类')
    default:
      return state
  }
}

const fmt = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`
  return JSON.stringify(v)
}

/** 属性路径的显示名：@self.ShopId → ShopId，@TxtTitle:text → TxtTitle 文字，:onScreen → 在屏上 */
export function propLabel(prop: string, o: DescribeOptions = {}): string {
  const given = o.label?.(prop)
  if (given) return given
  const t = o.t ?? ((s: string) => s)
  const r = parsePropPath(prop)
  if ('error' in r) return prop
  const p = r.path
  const head = p.root === 'named' || p.root === 'self' ? '' : `${p.root}.`
  const body = `${head}${p.segs.join('.')}`
  if (!p.state) return body
  return body ? `${body} ${stateWord(p.state, t)}` : stateWord(p.state, t)
}

/** 一条判断项：`ShopId = 1001`、`TxtTitle 文字 包含 杂货`、`在屏上`（bool 为 true 时只写名字） */
export function describeItem(item: Partial<GtIdentItem>, o: DescribeOptions = {}): string {
  const t = o.t ?? ((s: string) => s)
  const label = propLabel(item.prop ?? ':exists', o)
  const bare = bareOp(item.op, t)
  if (bare) return `${label} ${bare}`
  if ((item.op === undefined || item.op === 'is') && (item.value === true || item.value === undefined)) return label
  if ((item.op === undefined || item.op === 'is') && item.value === false) return `${t('不')}${label}`
  if (item.op === 'count') return `${label} ${t('个数')} ${opWord(item.cmp ?? 'eq', t)} ${fmt(item.value)}`
  return `${label} ${opWord(item.op, t)} ${fmt(item.value)}`
}

/**
 * 一个引用：内联 → `WBP_Shop（ShopId = 1001）`；命名引用 → 名字（objects 里有定义时后面带类，`shop · WBP_Shop`）；
 * `$var` 原样。容器条目带上所在（`WBP_BagSlot（ItemId = 1001）· 在 WBP_Bag 的 ItemList 里`）
 */
export function describeRef(ref: GtRefLike | unknown, o: DescribeOptions = {}): string {
  const t = o.t ?? ((s: string) => s)
  const form = refForm(ref)
  if (form === 'var') return ref as string
  if (form === 'name') {
    const def = namedRef(o.objects, ref)
    return def ? `${ref as string} · ${shortClass(def.class)}` : (ref as string)
  }
  if (form !== 'inline') return '?'
  const r = ref as GtRef
  const ident = Array.isArray(r.ident) ? r.ident.filter(isObj) : []
  let s = shortClass(r.class)
  if (ident.length) s += `（${ident.map((x) => describeItem(x as GtIdentItem, o)).join('，')}）`
  if (r.many === 'first') s += ` · ${t('第一个')}`
  else if (r.many === 'last') s += ` · ${t('最上层的')}`
  else if (r.many === 'nearest') s += ` · ${t('最近的')}`
  const io = inObj(r.in)
  if (io) {
    const owner = refForm(io.obj) === 'name' ? (io.obj as string) : describeRef(io.obj, { ...o, objects: undefined })
    s += io.part
      ? ` · ${t('在 {a} 的 {b} 里').replace('{a}', owner).replace('{b}', io.part)}`
      : ` · ${t('在 {a} 上').replace('{a}', owner)}`
  }
  return s
}

/** 部件写法：`shop › Header.BtnClose`，Slate 段跟在后面 */
export function describeTarget(target: unknown, o: DescribeOptions = {}): string {
  if (!isObj(target) || !('obj' in target)) return describeRef(target, o)
  const parts = [describeRef(target.obj, o)]
  if (typeof target.part === 'string' && target.part) parts.push(target.part)
  if (typeof target.slate === 'string' && target.slate) parts.push(target.slate)
  return parts.join(' › ')
}

/** 条件里的对象判断：`shop 的 TxtTitle 文字 包含 杂货`；prop 省略 = 存在 */
export function describeCheck(check: Obj, o: DescribeOptions = {}): string {
  const t = o.t ?? ((s: string) => s)
  return `${describeRef(check.obj, o)} ${t('的')} ${describeItem(check as Partial<GtIdentItem>, o)}`
}
