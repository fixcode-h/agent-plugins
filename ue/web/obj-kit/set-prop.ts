import { gtNames, objArg, objValue, stepOk } from '../../shared/gm/custom.ts'
import type { GmObject } from '../../shared/gm/schema.ts'
import { op } from '../api.ts'
import { runCall } from '../sections/gm/custom/run-custom.ts'
import type { Target } from '../../server/types.ts'

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
  /** 值是别的对象时：它的匹配规则（value 写 `@obj.名字`，GameTest 写的时候现找） */
  extra?: Record<string, unknown>,
) {
  const id = gtNames([o.name]).get(o.name)!
  const step = { action: 'obj.set', obj: objArg(id), prop, value }
  const r = await op<Record<string, unknown>>(
    project,
    'gt.step',
    { step, objects: { ...extra, [id]: objValue(o) } },
    target,
    30000,
  )
  if (!stepOk(r)) throw new Error(String(r.message || r.status || '改不了'))
}

/** 抓到的一个实例上这个变量的值 */
export interface Grabbed {
  name: string
  value: unknown
}

/**
 * 抓取一个变量此刻的值（用户 2026-11-22：抓取就是从运行中的游戏里取对象的值，和 GM「取对象」是一回事）：
 * 直接走「取对象」那条路（runCall kind=get → gt.resolve 带 show），只读这一个属性，匹配规则命中几个就回几个
 */
export async function readObjProp(
  project: string,
  target: Target | undefined,
  o: GmObject,
  prop: string,
): Promise<Grabbed[]> {
  const out = await runCall(
    project,
    { kind: 'get', obj: o.name, objects: { [o.name]: o }, props: [prop], args: {}, many: 'error' },
    {},
    target,
  )
  if (!out.ok) throw new Error(out.error || '抓取失败')
  const hits = (out.found?.items ?? []).filter((x) => x.match !== false)
  if (!hits.length) throw new Error('游戏里没找到这个对象：按匹配规则此刻命中 0 个')
  return hits.map((x) => ({ name: x.name, value: x.ident?.find((i) => i.prop === prop)?.actual }))
}
