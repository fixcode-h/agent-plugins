import {
  defaultOpFor,
  implicitOp,
  opDef,
  parsePropPath,
  stateOf,
  type GtIdentItem,
  type GtPropItem,
  type GtPropKind,
} from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'

/**
 * 比较和算出状态在界面上的说法。表本身（每种 kind 能用哪些 op、op 要不要值、状态的 kind）都在
 * shared/gt-script/ref 的注册表里（opsFor / opDef / stateOf），这里只放文案、点准星时的默认比较和本地粗判
 */

/** 不知道 kind 时（手写的属性、属性树里查不到）按名字认的「不要值」的 op */
const NO_VALUE_ANY = new Set(['isNull', 'notNull', 'empty', 'notEmpty', 'visible', 'hidden'])

/** 这个 op 不要 value（isNull、visible…） */
export function noValue(op: string, kind?: GtPropKind): boolean {
  const d = kind ? opDef(kind, op) : undefined
  return d ? d.value === 'none' : NO_VALUE_ANY.has(op)
}

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

/** 某个属性的 kind：属性树里有就按它，算出状态查注册表，其余不知道 */
export function kindOfProp(prop: string, items?: GtPropItem[]): GtPropKind | undefined {
  const hit = items?.find((i) => i.prop === prop)
  if (hit) return hit.kind
  const st = stateOfProp(prop)
  return st ? stateOf(st)?.kind : undefined
}

/** 属性路径里的算出状态名（`@Btn:enabled` → enabled）；不是状态返回 undefined */
export function stateOfProp(prop: string): string | undefined {
  const r = parsePropPath(prop)
  return 'path' in r ? r.path.state : undefined
}

/** 枚举成员：属性树给了就用（members 是协议外的可选字段），否则按引擎类型名查常见的 */
export function membersOf(item?: Pick<GtPropItem, 'type' | 'kind'> & { members?: string[] }): string[] {
  if (item?.members?.length) return item.members
  if (item?.kind === 'visibility') return KNOWN_ENUMS.ESlateVisibility
  return KNOWN_ENUMS[item?.type ?? ''] ?? []
}

/** 点准星加进来时的默认比较：op 用注册表里这类的默认，值是「此刻的值」 */
export function defaultIdent(item: Pick<GtPropItem, 'prop' | 'kind' | 'value'>): GtIdentItem {
  const v = item.value
  const op = defaultOpFor(item.kind) ?? implicitOp(item.kind)
  switch (opDef(item.kind, op)?.value) {
    case 'none':
      return { prop: item.prop, op }
    case 'count':
      return { prop: item.prop, op, cmp: 'gte', value: 1 }
    case 'list':
      return { prop: item.prop, op, value: v === undefined ? [] : [v] }
    case 'pair':
      return { prop: item.prop, op, value: [v ?? 0, v ?? 0] }
    default:
      return { prop: item.prop, op, value: item.kind === 'bool' ? (v === undefined ? true : !!v) : (v ?? '') }
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
