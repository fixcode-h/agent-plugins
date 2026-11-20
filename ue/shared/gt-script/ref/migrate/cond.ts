import { childrenOf, groupKind } from '../../cond.ts'
import { propOnPart } from '../prop-path.ts'
import type { GtTarget } from '../types.ts'
import { todo, type MigrateCtx } from './context.ts'
import { propCall } from './expr.ts'
import { selectorToTarget } from './selector.ts'

/**
 * 条件里按控件写的判断（v3：target + exists / visible / text / number / field …）→ v4 的对象判断
 * {obj, prop, op, value}（协议第 9 节）：
 * - visible / exists / enabled / checked / selected / onScreen → `:shown` `:exists` `:enabled` `:checked` `:selected` `:onScreen` + is
 * - text / textContains / textLike / textMatches → `:text` + eq / contains / contains（加 todo，textLike 原来忽略数字标点）/ matches
 * - number → `:text` 不能直接比数字，写成表达式 num(prop(引用, ":text")) > 3
 * - count / image / field → `:count` / `:image`（contains，原来按资源名包含）/ field 的路径照抄
 * 一条判断里写了好几项时拆成 all。值来源（value / api / expr / alias / actorNear）不是对象判断，原样留着
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const STATES: Record<string, string> = {
  exists: ':exists',
  visible: ':shown',
  enabled: ':enabled',
  checked: ':checked',
  selected: ':selected',
  onScreen: ':onScreen',
}
const TEXTS: Record<string, string> = {
  text: 'eq',
  textContains: 'contains',
  textLike: 'contains',
  textMatches: 'matches',
}
/** v3 的比较名 → v4 的 op */
export const CMP: Record<string, string> = {
  equals: 'eq',
  ne: 'ne',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  in: 'in',
  contains: 'contains',
  matches: 'matches',
}
const EXPR_OP: Record<string, string> = { eq: '==', equals: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }
const WIDGET_KEYS = [
  ...Object.keys(STATES),
  ...Object.keys(TEXTS),
  'number',
  'count',
  'image',
  'field',
  'selectedProperty',
  'stateKey',
]
/** 快照 state 键 → 控件上确定的反射属性（其余按首字母大写猜，写 todo） */
const STATE_KEY_PROPS: Record<string, string> = { value: 'Value', activeIndex: 'ActiveWidgetIndex' }
/** 条件根上的配置（稳住时间、skipIf 的 also / verify…）：不是判断，迁移时留在根上 */
const ROOT_KEYS = ['settleMs', 'elseSettleMs', 'also', 'verify', 'verifyTimeoutMs', 'by']

/** 判断项里的比较（v3 写在判断对象上的 equals / gt …）：取第一个 */
function cmpOf(leaf: Obj): { op: string; value: unknown } | undefined {
  for (const [k, op] of Object.entries(CMP)) if (k in leaf) return { op, value: leaf[k] }
  return undefined
}

/** 一条 v3 判断 → 一条或几条 v4 对象判断 */
function migrateCheck(leaf: Obj, ctx: MigrateCtx, defTarget?: unknown): Obj {
  if ('obj' in leaf) return leaf
  const keys = WIDGET_KEYS.filter((k) => k in leaf)
  if (!keys.length) return leaf
  const sel = leaf.target ?? defTarget
  const t: GtTarget | undefined = selectorToTarget(sel, ctx)
  if (!t) {
    todo(ctx, `判断（${keys.join('、')}）没写看哪个控件，迁不了`)
    return leaf
  }
  const base: Obj = { obj: t.obj, ...('client' in leaf ? { client: leaf.client } : {}) }
  const on = (rest: string) => propOnPart(t.part, rest)
  const out: Obj[] = []
  if (t.slate) todo(ctx, `判断看的是 Slate 控件 ${t.slate}，v4 的对象判断读不到，改看它所在的部件`)
  for (const k of keys) {
    const v = leaf[k]
    if (k in STATES) {
      const value = k === 'checked' && typeof v === 'boolean' ? (v ? 'Checked' : 'Unchecked') : v
      out.push({ ...base, prop: on(STATES[k]), op: 'is', value })
    } else if (k in TEXTS) {
      if (k === 'textLike')
        todo(ctx, `textLike「${String(v)}」原来忽略数字和标点，改成了包含：确认不会误判（比如「已领取」包含「领取」）`)
      out.push({ ...base, prop: on(':text'), op: TEXTS[k], value: v })
    } else if (k === 'image') out.push({ ...base, prop: on(':image'), op: 'contains', value: v })
    else if (k === 'count') {
      const c = isObj(v)
        ? (cmpOf(v) ?? { op: Object.keys(v)[0], value: Object.values(v)[0] })
        : typeof v === 'number'
          ? { op: 'eq', value: v }
          : cmpOf(leaf)
      out.push({ ...base, prop: on(':count'), op: c?.op ?? 'eq', value: c?.value ?? v })
    } else if (k === 'number') out.push({ expr: numberExpr(t, v, ctx) })
    else if (k === 'field' && typeof v === 'string') {
      // field 读的是控件所在 WBP（对象）的字段，不是部件的，所以路径照抄、不拼部件
      const c = cmpOf(leaf)
      out.push({ ...base, prop: v, ...(c ? { op: c.op, value: c.value } : {}) })
    } else if ((k === 'stateKey' || k === 'selectedProperty') && typeof v === 'string' && v) {
      // 快照 state 里的键 / 列表选中项的属性：v4 读控件自己的属性，按常见控件猜一个，猜不准的写 todo
      const exact = STATE_KEY_PROPS[v]
      const name = k === 'stateKey' ? (exact ?? v[0].toUpperCase() + v.slice(1)) : `SelectedItem.${v}`
      const prop = t.part ? `@${t.part}.${name}` : `@self.${name}`
      if (!exact) todo(ctx, `${k}「${v}」改成了读属性 ${prop}，按控件实际的属性名核对`)
      const c = cmpOf(leaf)
      out.push({ ...base, prop, ...(c ? { op: typeof c.value === 'boolean' ? 'is' : c.op, value: c.value } : {}) })
    } else todo(ctx, `判断里的 ${k} 没有对应的写法，改成 {obj, prop, op, value}`)
  }
  if (!out.length) return leaf
  return out.length === 1 ? out[0] : { all: out }
}

/** number: {gt: 3} / {between: [a, b]} / 3 → 表达式 */
function numberExpr(t: GtTarget, v: unknown, ctx: MigrateCtx): string {
  const read = `num(${propCall(t.obj, t.part, ':text')})`
  const parts: string[] = []
  const conds = isObj(v) ? Object.entries(v) : [['eq', v] as [string, unknown]]
  for (const [op, x] of conds) {
    if (op === 'between' && Array.isArray(x) && x.length === 2)
      parts.push(`${read} >= ${JSON.stringify(x[0])} and ${read} <= ${JSON.stringify(x[1])}`)
    else if (op in EXPR_OP) parts.push(`${read} ${EXPR_OP[op]} ${JSON.stringify(x)}`)
    else todo(ctx, `number 的比较 ${op} 改不了`)
  }
  return parts.join(' and ') || `${read} != null`
}

/** 条件树：组照原样递归（组上写了 target 时当里面判断的默认控件），叶子按上面迁 */
function migrateNode(node: unknown, ctx: MigrateCtx, defTarget?: unknown): unknown {
  if (!isObj(node)) return node
  const k = groupKind(node)
  if (!k) return migrateCheck(node, ctx, defTarget)
  const inner = node.target ?? defTarget
  const out: Obj = { ...node }
  if (k === 'not') out.not = migrateNode(node.not, ctx, inner)
  else out[k] = childrenOf(node).map((c) => migrateNode(c, ctx, inner))
  if ('target' in out && WIDGET_KEYS.every((x) => !(x in out))) delete out.target
  return out
}

/**
 * 迁一整个条件（if 的 cond、skipIf、守护 when …）。defTarget：判断没写 target 时看哪个控件（skipIf 省略 = 这一步自己的 target）。
 * 根上的配置（settleMs、also、verify …）留在根上；拆成 all 时也挂在 all 那一层
 */
export function migrateCond(cond: unknown, ctx: MigrateCtx, defTarget?: unknown): unknown {
  if (!isObj(cond)) return cond
  if (groupKind(cond)) return migrateNode(cond, ctx, defTarget)
  const root: Obj = {}
  const body: Obj = {}
  for (const [k, v] of Object.entries(cond)) (ROOT_KEYS.includes(k) ? root : body)[k] = v
  const next = migrateCheck(body, ctx, defTarget)
  return { ...next, ...root }
}

/** 判断里有没有 v3 按控件写的项（迁移前后比对、决定要不要动这一步） */
export const hasWidgetCheck = (leaf: Obj) => !('obj' in leaf) && WIDGET_KEYS.some((k) => k in leaf)
export { WIDGET_KEYS }
