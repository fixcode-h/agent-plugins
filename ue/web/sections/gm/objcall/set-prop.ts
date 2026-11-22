import { gtNames, objArg, objValue, stepOk } from '../../../../shared/gm/custom.ts'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import type { GtPropsResult } from '../../../../shared/gt-script/ref/types.ts'
import { op } from '../../../api.ts'
import { normalizeGroups } from '../../uekit/gt-ref/props-shape.ts'
import type { Target } from '../../../../server/types.ts'

/**
 * 对象调用中栏直接改值（用户 2026-11-22：Lua 变量、属性都能直接改）：跑一步 GameTest 的 obj.set，
 * 和调函数一样按匹配规则现找对象。UE 属性把输入原样交给 obj.set（反射 ImportText 认 UE 的文字写法），
 * Lua 字段按类型转成数字 / 布尔，表格写 JSON
 */
export function luaValue(type: string | undefined, raw: string): unknown {
  const s = raw.trim()
  const ty = (type ?? '').toLowerCase()
  if (/^(number|integer|float|int)/.test(ty)) {
    const n = Number(s)
    if (s === '' || Number.isNaN(n)) throw new Error(`「${raw}」不是数字`)
    return n
  }
  if (ty.startsWith('bool')) return s === 'true' || s === '1'
  if (ty.startsWith('string')) return raw
  // any / table / 没写类型：像 JSON 的按 JSON（数字、true、{…}），其余当字符串
  try {
    return JSON.parse(s)
  } catch {
    return raw
  }
}

export async function setObjProp(
  project: string,
  target: Target | undefined,
  o: GmObject,
  prop: string,
  value: unknown,
) {
  const id = gtNames([o.name]).get(o.name)!
  const step = { action: 'obj.set', obj: objArg(id), prop, value }
  const r = await op<Record<string, unknown>>(
    project,
    'gt.step',
    { step, objects: { [id]: objValue(o) } },
    target,
    30000,
  )
  if (!stepOk(r)) throw new Error(String(r.message || r.status || '改不了'))
}

/** 抓取一个变量此刻的值：gt.props 读整个对象，挑出这一项（路径对不上时按名字） */
export async function readObjProp(
  project: string,
  target: Target | undefined,
  o: GmObject,
  prop: string,
  name: string,
): Promise<unknown> {
  if (!o.ref) throw new Error('来源对象读不了属性：在 GameTest 的选对象面板里看')
  const r = await op<GtPropsResult>(project, 'gt.props', { target: { obj: o.ref } }, target, 30000)
  const items = normalizeGroups(r).flatMap((g) => g.items)
  const it = items.find((x) => x.prop === prop) ?? items.find((x) => x.name === name)
  if (!it) throw new Error(`对象上没有「${name}」`)
  return it.value
}
