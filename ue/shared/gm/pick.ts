import type { GmMany, GmRef } from './schema.ts'

/**
 * 挑实例（GM 页梳理 F2）：对象命中多个时，在头卡上勾要的那几个，本次调用 / 读取 / 改值只对它们生效。
 * 做法是在匹配规则后面再加一条按对象名认的条件（GameTest 2.2.2 的 `@:name`）：勾一个用 eq，勾几个用 any 组，
 * 多个时 many 改成 each（每个都调）。只用于这一次执行，保存为 GM 时不带（对象名每次开游戏可能不一样）
 */
export function narrowRef(ref: GmRef, names: string[]): GmRef {
  if (!names.length) return ref
  const eq = (value: string) => ({ prop: '@:name', op: 'eq', value })
  const extra = names.length === 1 ? eq(names[0]) : { any: names.map(eq) }
  const r = ref as GmRef & { ident?: unknown[] }
  return { ...r, ident: [...(r.ident ?? []), extra] } as GmRef
}

/** 挑了几个时的 many：挑多个就每个都调，挑一个或没挑照用户选的 */
export const narrowMany = (names: string[], many: GmMany): GmMany => (names.length > 1 ? 'each' : many)
