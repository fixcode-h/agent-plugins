import type { GtIdentGroup, GtIdentItem, GtIdentNode } from './types.ts'

/**
 * 唯一标识的条件组（协议 3.5，GameTest 2.1.6）：`ident` 顶层每项都要满足；一项可以是条件组
 * `{all: [...]}`（都满足）/ `{any: [...]}`（任一满足），组里再套子组，判断项和组都能 `not: true` 取反。
 * 这里是纯数据的读写：编辑栏、校验、描述、实例表都按它走，不各写一套
 */

/** 最多套几层（和 C++ FGameTestIdentItem::GroupDepth 一致） */
export const IDENT_GROUP_DEPTH = 4

export type GtIdentJoin = 'all' | 'any'

export const isIdentGroup = (n: unknown): n is GtIdentGroup =>
  !!n && typeof n === 'object' && (Array.isArray((n as GtIdentGroup).all) || Array.isArray((n as GtIdentGroup).any))

/** 组怎么合：写了 all 就是 all（两个都写校验会报） */
export const joinOf = (g: GtIdentGroup): GtIdentJoin => (Array.isArray(g.all) ? 'all' : 'any')

/** 组里的项 */
export const kidsOf = (g: GtIdentGroup): GtIdentNode[] => (Array.isArray(g.all) ? g.all : (g.any ?? []))

/** 拼一个组（不写多余的字段） */
export function makeGroup(join: GtIdentJoin, kids: GtIdentNode[], not?: boolean): GtIdentGroup {
  return { [join]: kids, ...(not ? { not: true } : {}) } as GtIdentGroup
}

/** 判断项（叶子），按出现顺序；同一个 prop 只收一次（实例表、此刻值按 prop 对） */
export function identLeaves(nodes: readonly GtIdentNode[] | undefined): GtIdentItem[] {
  const out: GtIdentItem[] = []
  const walk = (list: readonly GtIdentNode[]) => {
    for (const n of list) {
      if (isIdentGroup(n)) walk(kidsOf(n))
      else if (n && typeof n === 'object' && !out.some((x) => x.prop === n.prop)) out.push(n)
    }
  }
  walk(nodes ?? [])
  return out
}

/** 一共几个判断项（重复的 prop 也算） */
export function countLeaves(nodes: readonly GtIdentNode[] | undefined): number {
  let n = 0
  for (const x of nodes ?? []) n += isIdentGroup(x) ? countLeaves(kidsOf(x)) : 1
  return n
}

/**
 * 编辑栏的「条件组」= 顶层每一项：判断项看成只有它一项、都满足的组，方便统一画卡片
 */
export function toGroups(nodes: readonly GtIdentNode[] | undefined): GtIdentGroup[] {
  return (nodes ?? []).map((n) => (isIdentGroup(n) ? n : makeGroup('all', [n])))
}

/**
 * 存盘前收拾：去掉空组；只有一项、都满足、不取反的组拆掉这一层（和直接写那一项等价，旧的平铺写法保持原样）；
 * 子组里同样处理（子组只剩一项时也拆掉）
 */
export function normalizeIdent(nodes: readonly GtIdentNode[]): GtIdentNode[] {
  const tidy = (n: GtIdentNode): GtIdentNode | undefined => {
    if (!isIdentGroup(n)) return n
    const kids = kidsOf(n)
      .map(tidy)
      .filter((x): x is GtIdentNode => !!x)
    if (!kids.length) return undefined
    if (kids.length === 1 && !n.not) return kids[0]
    if (kids.length === 1 && n.not && !isIdentGroup(kids[0])) {
      // 非（只有一项）= 那一项取反
      const leaf = kids[0] as GtIdentItem
      return leaf.not ? withoutNot(leaf) : { ...leaf, not: true }
    }
    return makeGroup(joinOf(n), kids, n.not)
  }
  return nodes.map(tidy).filter((x): x is GtIdentNode => !!x)
}

const withoutNot = (leaf: GtIdentItem): GtIdentItem => {
  const { not: _not, ...rest } = leaf
  return rest
}

/** 一个组（或顶层）在树里的位置：顶层第几组，再往下第几项…… */
export type IdentPath = number[]

/** 按位置取组；顶层位置 [i] 是 toGroups 的第 i 组 */
export function groupAt(groups: readonly GtIdentGroup[], at: IdentPath): GtIdentGroup | undefined {
  let g: GtIdentGroup | undefined = groups[at[0]]
  for (const i of at.slice(1)) {
    const kid: GtIdentNode | undefined = g ? kidsOf(g)[i] : undefined
    g = isIdentGroup(kid) ? kid : undefined
  }
  return g
}

/** 改位置 at 上的组（返回新的组列表，不改原来的） */
export function updateGroupAt(
  groups: readonly GtIdentGroup[],
  at: IdentPath,
  fn: (g: GtIdentGroup) => GtIdentGroup,
): GtIdentGroup[] {
  const rec = (g: GtIdentGroup, rest: number[]): GtIdentGroup => {
    if (!rest.length) return fn(g)
    const kids = kidsOf(g).map((k, i) => (i === rest[0] && isIdentGroup(k) ? rec(k, rest.slice(1)) : k))
    return makeGroup(joinOf(g), kids, g.not)
  }
  return groups.map((g, i) => (i === at[0] ? rec(g, at.slice(1)) : g))
}

/** 组里有没有这个 prop（只看这一层，子组不算）：准星的「已加」按当前目标组看 */
export const groupHasProp = (g: GtIdentGroup | undefined, prop: string) =>
  !!g && kidsOf(g).some((k) => !isIdentGroup(k) && k.prop === prop)

/** 子组还能不能再套一层（at 的长度就是深度：顶层组是 1） */
export const canNest = (at: IdentPath) => at.length < IDENT_GROUP_DEPTH
