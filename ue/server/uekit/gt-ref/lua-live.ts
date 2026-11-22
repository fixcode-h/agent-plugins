import { comparable, opsFor } from '../../../shared/gt-script/ref/compare/index.ts'
import type { GtPropItem, GtPropKind } from '../../../shared/gt-script/ref/types.ts'
import { t } from '../../util.ts'

/**
 * 选对象时实例上的 Lua 字段此刻的值（用户 2026-11-22：游戏开着，self.DefaultFOV 却显示「游戏没开」、不能加进唯一判定）。
 * gt.props 给的 Lua 字段是 UE 铺平实例表再按名额截的，大子表会把名额吃光；这里按对象路径直接读实例表这一层（UELink lua.get），
 * 补上 UE 没给的字段。只读这一层：判定条件比的是 `@#字段`，子表本来就展开了比成员。
 */

/** lua.get 回的 fields 里的一项 */
export interface LuaLiveField {
  k?: string
  kt?: string
  t?: string
  v?: unknown
  int?: boolean
}

export type LuaLive = Map<string, LuaLiveField>

/** 只认字符串键（数字键是数组项，不是字段） */
export function liveMap(fields: unknown): LuaLive {
  const out: LuaLive = new Map()
  if (!Array.isArray(fields)) return out
  for (const f of fields as LuaLiveField[])
    if (f && typeof f.k === 'string' && f.k && (f.kt ?? 'string') === 'string') out.set(f.k, f)
  return out
}

/** Lua 值的类型 → 比较表的 kind；函数、userdata 这类读不出能比的值 */
function kindOf(f: LuaLiveField): GtPropKind | undefined {
  switch (f.t) {
    case 'number':
      return f.int ? 'int' : 'float'
    case 'string':
      return 'string'
    case 'boolean':
      return 'bool'
    case 'table':
      return 'array'
  }
  return undefined
}

/** 实例表上的一项 → 属性树的一项（值是此刻的）；函数不算字段，给 undefined */
export function liveItem(name: string, f: LuaLiveField, o: { type?: string; declAt?: string; note?: string }) {
  if (f.t === 'function' || f.t === 'nil') return undefined
  const kind = kindOf(f)
  const item: GtPropItem = {
    prop: `@#${name}`,
    name,
    src: 'lua',
    type: o.type && o.type !== 'any' ? o.type : (f.t ?? 'any'),
    kind: kind ?? 'none',
  }
  // 表的 v 是「table: 0x…」这类摘要，不当值给
  if (f.t !== 'table' && f.v !== undefined) item.value = f.v
  if (o.declAt) item.declAt = o.declAt
  if (o.note) item.note = o.note
  if (kind && comparable(kind)) item.ops = opsFor(kind)
  else {
    item.comparable = false
    item.why = t('Lua 里是 {type}，读不出能比的值', { type: f.t ?? '?' })
  }
  return item
}
