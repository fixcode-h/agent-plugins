import type { GtIdentItem, GtPropItem, GtPropKind } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'

/**
 * 【临时本地适配】按属性类型的比较表（协议 game-test-ref.md 3.4）和算出状态表（3.2）。
 * 数据层的那一份在 shared/gt-script/ref/compare.ts（对方在写，单测核对协议表格）；合并时这里只留界面用的
 * 文案（opLabel），表本身换成 import shared 的同名导出。名字、适用 kind 和协议逐字一致，不要在这里自己加 op
 */

const NUM_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in']
const STR_OPS = ['eq', 'ne', 'contains', 'startsWith', 'endsWith', 'matches', 'in']
const ENUM_OPS = ['is', 'isNot', 'in']

export const KIND_OPS: Record<GtPropKind, string[]> = {
  bool: ['is'],
  int: NUM_OPS,
  float: NUM_OPS,
  string: STR_OPS,
  text: [...STR_OPS, 'key'],
  enum: ENUM_OPS,
  visibility: [...ENUM_OPS, 'visible', 'hidden'],
  object: ['isNull', 'notNull', 'classIs', 'nameIs'],
  asset: ['eq', 'contains', 'isNull', 'notNull'],
  vector: ['near', 'eq'],
  rotator: ['near', 'eq'],
  vector2: ['near', 'eq'],
  color: ['near'],
  array: ['count', 'has', 'empty', 'notEmpty'],
  struct: [],
  none: [],
}

/** 不要 value 的比较 */
export const NO_VALUE_OPS = new Set(['visible', 'hidden', 'isNull', 'notNull', 'empty', 'notEmpty'])

/** array 的 count 配的数字比较（cmp） */
export const COUNT_CMPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']

/** 比较的中文名（下拉里左边中文、右边 op 原名，效果图 3） */
export function opLabel(op: string): string {
  const m: Record<string, () => string> = {
    is: () => t('是'),
    isNot: () => t('不是'),
    eq: () => t('等于'),
    ne: () => t('不等于'),
    gt: () => '>',
    gte: () => '≥',
    lt: () => '<',
    lte: () => '≤',
    between: () => t('在…之间'),
    in: () => t('在这些里'),
    contains: () => t('包含'),
    startsWith: () => t('开头是'),
    endsWith: () => t('结尾是'),
    matches: () => t('正则'),
    key: () => t('按本地化键'),
    visible: () => t('显示'),
    hidden: () => t('隐藏'),
    isNull: () => t('为空'),
    notNull: () => t('不为空'),
    classIs: () => t('类是（按继承）'),
    nameIs: () => t('名字是'),
    near: () => t('接近'),
    count: () => t('个数'),
    has: () => t('含有'),
    empty: () => t('为空'),
    notEmpty: () => t('不为空'),
  }
  return m[op]?.() ?? op
}

/** 算出状态（协议 3.2）的 kind：编辑器没开、属性树里查不到时按它给比较 */
export const STATE_KINDS: Record<string, GtPropKind> = {
  exists: 'bool',
  onScreen: 'bool',
  shown: 'bool',
  enabled: 'bool',
  text: 'text',
  textKey: 'string',
  count: 'int',
  index: 'int',
  selected: 'bool',
  checked: 'enum',
  image: 'asset',
  hovered: 'bool',
  focused: 'bool',
  pos: 'vector2',
  size: 'vector2',
  location: 'vector',
  distance: 'float',
  hiddenInGame: 'bool',
  class: 'object',
}

/** 算出状态的一句话（判断种类的下拉、属性树「算出状态」行的悬停说明） */
export function stateHint(state: string): string {
  const m: Record<string, () => string> = {
    exists: () => t('按类和标识找得到'),
    onScreen: () => t('在视口里、父链都可见、有尺寸'),
    shown: () => t('自己和父链都不是 Collapsed / Hidden'),
    enabled: () => t('自己和父链都 enabled（按钮能不能点）'),
    text: () => t('显示出来的字'),
    textKey: () => t('本地化键，换语言也不变'),
    count: () => t('子项 / 条目数'),
    index: () => t('第几个（只用于显示，不建议当标识）'),
    selected: () => t('列表条目是否选中'),
    checked: () => t('勾选框的状态'),
    image: () => t('当前图片的资源名'),
    hovered: () => t('光标在上面'),
    focused: () => t('有键盘焦点'),
    pos: () => t('视口归一化位置（左上角）'),
    size: () => t('视口归一化大小'),
    location: () => t('世界位置'),
    distance: () => t('离本地 Pawn 的距离（厘米）'),
    hiddenInGame: () => t('Actor 是否隐藏'),
    class: () => t('实际类名'),
  }
  return m[state]?.() ?? ''
}

/** 常见引擎枚举的成员：gt.props 没给 members 时（编辑器没开）下拉用这份 */
export const KNOWN_ENUMS: Record<string, string[]> = {
  ESlateVisibility: ['Visible', 'Collapsed', 'Hidden', 'HitTestInvisible', 'SelfHitTestInvisible'],
  ECheckBoxState: ['Checked', 'Unchecked', 'Undetermined'],
}

/** `---@field` 写的 Lua 类型 → kind（协议 7.5）；认不出返回 undefined（按运行时值） */
export function luaKindOf(type: string | undefined): GtPropKind | undefined {
  const s = (type ?? '').trim().replace(/\?$/, '')
  if (!s) return undefined
  if (s === 'number') return 'float'
  if (s === 'integer') return 'int'
  if (s === 'string') return 'string'
  if (s === 'boolean') return 'bool'
  if (s === 'table' || s.endsWith('[]') || /^table</.test(s)) return 'array'
  return undefined
}

/** 属性路径拆开：部件（可能多段）、是不是算出状态、末段名 */
export function splitProp(prop: string): { part?: string; state?: string; field?: string } {
  const p = prop.trim().replace(/^@/, '')
  const colon = p.indexOf(':')
  if (colon >= 0) return { part: p.slice(0, colon) || undefined, state: p.slice(colon + 1) }
  const segs = p.split('.')
  if (segs[0] === 'self' || segs[0] === 'lua' || segs[0] === 'item' || segs[0] === 'itemLua')
    return { field: segs.slice(1).join('.') }
  return { part: segs[0], field: segs.slice(1).join('.') }
}

/** 部件上的算出状态的写法：没有部件就是对象本身（`:onScreen`） */
export const propOn = (part: string | undefined, state: string) => (part ? `@${part}:${state}` : `:${state}`)

/** 某个属性的 kind：属性树里有就按它，算出状态查表，其余不知道 */
export function kindOfProp(prop: string, items?: GtPropItem[]): GtPropKind | undefined {
  const hit = items?.find((i) => i.prop === prop)
  if (hit) return hit.kind
  const { state } = splitProp(prop)
  return state ? STATE_KINDS[state] : undefined
}

/** 枚举成员：属性树给了就用（members 是协议外的可选字段），否则按引擎类型名查常见的 */
export function membersOf(item?: Pick<GtPropItem, 'type' | 'kind'> & { members?: string[] }): string[] {
  if (item?.members?.length) return item.members
  if (item?.kind === 'visibility') return KNOWN_ENUMS.ESlateVisibility
  return KNOWN_ENUMS[item?.type ?? ''] ?? []
}

/** 点准星加进来时的默认比较（设计稿第 4 节「默认」列）：一般是「等于此刻的值」 */
export function defaultIdent(item: Pick<GtPropItem, 'prop' | 'kind' | 'value'>): GtIdentItem {
  const v = item.value
  switch (item.kind) {
    case 'bool':
      return { prop: item.prop, op: 'is', value: v === undefined ? true : !!v }
    case 'visibility':
      return { prop: item.prop, op: 'visible' }
    case 'enum':
      return { prop: item.prop, op: 'is', value: v ?? '' }
    case 'object':
      return { prop: item.prop, op: 'notNull' }
    case 'vector':
    case 'rotator':
    case 'vector2':
    case 'color':
      return { prop: item.prop, op: 'near', value: v ?? [] }
    case 'array':
      return { prop: item.prop, op: 'count', cmp: 'gte', value: 1 }
    default:
      return { prop: item.prop, op: 'eq', value: v ?? '' }
  }
}

/** 本地粗判一条标识对某个实际值成不成立（同类实例表里写「排除：因为哪条」）；判不了返回 undefined */
export function testIdent(it: GtIdentItem, actual: unknown): boolean | undefined {
  const op = it.op ?? 'eq'
  const v = it.value
  if (typeof v === 'string' && (v.startsWith('$') || v.startsWith('='))) return undefined
  const ic = it.ignoreCase !== false
  const s = (x: unknown) => (ic ? String(x ?? '').toLowerCase() : String(x ?? ''))
  switch (op) {
    case 'is':
    case 'eq':
      return typeof actual === 'number' && typeof v === 'number'
        ? Math.abs(actual - v) <= (it.tol ?? 0.001)
        : s(actual) === s(v)
    case 'ne':
    case 'isNot':
      return s(actual) !== s(v)
    case 'contains':
      return s(actual).includes(s(v))
    case 'startsWith':
      return s(actual).startsWith(s(v))
    case 'endsWith':
      return s(actual).endsWith(s(v))
    case 'gt':
      return Number(actual) > Number(v)
    case 'gte':
      return Number(actual) >= Number(v)
    case 'lt':
      return Number(actual) < Number(v)
    case 'lte':
      return Number(actual) <= Number(v)
    case 'in':
      return Array.isArray(v) ? v.some((x) => s(x) === s(actual)) : undefined
    default:
      return undefined
  }
}
