import { opsFor } from '../../../shared/gt-script/ref/compare/index.ts'
import type { GtPropGroup, GtPropKind } from '../../../shared/gt-script/ref/types.ts'

/**
 * ue_gametest 的 props（协议 game-test-ref 7.3）：Agent 从代码写 v5 脚本时要知道对象上有哪些属性、
 * 哪些能当标识（score、suggest）。走 runOp（版本门槛、Lua 补全在 ops.ts 那一层），
 * 这里只整理参数和把返回压到 ADR 0067 的上限内。
 */
type A = Record<string, unknown>
type Op = (name: string, args?: A, timeout?: number) => Promise<A>
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d)
const isObj = (v: unknown): v is A => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 每项的 ops 在比较表里按 kind 就能查到，逐项重复很占字：拿掉，顶上给一份 opsByKind
 * （Agent 读的是这份，网页直接调 gt.props 拿完整的）
 */
export function slimProps(res: A): A {
  if (!Array.isArray(res.groups)) return res
  const kinds = new Set<GtPropKind>()
  const groups = (res.groups as GtPropGroup[]).map((g) => ({
    ...g,
    items: g.items.map(({ ops: _ops, ...x }) => {
      kinds.add(x.kind)
      return x
    }),
  }))
  const opsByKind = Object.fromEntries([...kinds].map((k) => [k, opsFor(k)] as const).filter(([, ops]) => ops.length))
  return { ...res, groups, opsByKind }
}

export async function gtProps(op: Op, a: A): Promise<A> {
  const args: A = {}
  if (typeof a.class === 'string' && a.class) args.class = a.class
  else if (isObj(a.target)) args.target = a.target
  else if (a.object !== undefined) args.target = { obj: a.object }
  else
    return { error: 'props 要给 class（只按类，不用开游戏），或 target {obj, part?} / object（对象引用，游戏要开着）' }
  for (const k of ['part', 'filter']) if (typeof a[k] === 'string' && a[k]) args[k] = a[k]
  if (typeof a.module === 'string' && a.module) args.luaModule = a.module
  args.offset = num(a.offset, 0)
  args.limit = Math.min(num(a.limit, 120), 400)
  return slimProps(await op('gt.props', args))
}
