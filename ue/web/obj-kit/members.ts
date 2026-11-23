import type { GmObject } from '../../shared/gm/schema.ts'
import type { Prop } from '../details/model.ts'
import type { PropsData } from '../sections/uekit/gt-ref/live.ts'
import type { VarGroup, VarItem, VarScope } from '../sections/uekit/gt-vars/model.ts'
import type { CallParam } from './CallForm.tsx'

/**
 * 对象调用中栏的数据（规格第 7 节）：方法 = gt.vars scope=object 的函数（按声明类分组），Lua = Lua 组，
 * 属性 = gt.props（交给 Details 只读显示，按 UPROPERTY Category 分组），运行状态 = gt.props 里 src=state 的。
 * 都复用 GameTest 的操作，不另写一套
 */

/** 对象 → gt.vars 的范围：匹配规则按引用列；来源 @pawn / @sub.X / @luaMod.X 按玩家、子系统、Lua 模块列 */
export function scopeOf(o: GmObject | undefined): VarScope | undefined {
  if (!o) return undefined
  if (o.ref) return { scope: 'object', ref: o.ref }
  const s = o.src ?? ''
  if (s === '@pawn') return { scope: 'player', which: 'pawn' }
  const m = /^@(\w+)\.(.+)$/.exec(s)
  if (m?.[1] === 'sub') return { scope: 'subsystem', name: m[2] }
  if (m?.[1] === 'luaMod') return { scope: 'lua', module: m[2] }
  return undefined
}

/** 一个能调的函数 */
export interface FnInfo {
  name: string
  sig: string
  /** C++ / 蓝图 / Lua */
  src: 'cpp' | 'bp' | 'lua'
  /** 声明它的类（方法按它分组） */
  owner: string
  params: CallParam[]
  callable: boolean
  why?: string
}

const LUA_PRIMS = /^(number|integer|string|boolean|table|any|nil|function|userdata|fun\(.*|[\w.]+\[\])$/i

type Arg = NonNullable<VarItem['args']>[number] & { objectClass?: string }

/** 函数参数 → 表单的一项：UObject 参数（objectClass）和 Lua 注释写了 Lua 类的参数出对象下拉 */
function paramOf(a: Arg, lua: boolean): CallParam {
  const type = a.type ?? ''
  if (a.objectClass || a.object)
    return { name: a.name, type, obj: { cls: a.objectClass ?? type.replace(/\*$/, ''), lua: false } }
  if (lua && type && !LUA_PRIMS.test(type)) return { name: a.name, type, obj: { cls: type, lua: true } }
  return { name: a.name, type }
}

export function fnsOf(groups: VarGroup[]): FnInfo[] {
  return groups.flatMap((g) =>
    g.items
      .filter((it) => it.kind === 'fn')
      .map((it) => ({
        name: it.name,
        sig: it.sig ?? '',
        src: g.src,
        owner: g.class ?? g.title,
        params: (it.args ?? []).filter((a) => !a.out && !a.auto).map((a) => paramOf(a, g.src === 'lua')),
        callable: it.callable !== false,
        why: it.why,
      })),
  )
}

/**
 * gt.props → Details 的属性：名字用属性路径（行尾按钮按它挑「取对象」要读的属性、改值时交给 obj.set），显示名用字段名。
 * which：属性（UE 反射属性）/ 运行状态（只读）/ Lua 字段。用户 2026-11-22：属性和 Lua 变量能直接改；
 * 只读的、只在源码里看到的 Lua 字段（游戏里还没这个值）不能改
 */
export function propsOf(data: PropsData | undefined, which: 'props' | 'states' | 'lua'): Prop[] {
  const pick = (src: string) =>
    which === 'lua' ? src === 'lua' : src !== 'lua' && (src === 'state') === (which === 'states')
  return (data?.groups ?? []).flatMap((g) =>
    g.items
      .filter((it) => pick(it.src) && !it.luaFn)
      .map((it) => ({
        name: it.prop,
        displayName: it.name,
        type: it.type,
        category: (it as { cat?: string }).cat || g.title,
        value: it.value,
        readOnly: which === 'states' || !!it.readOnly || !!it.fromSource,
        readOnlyWhy: it.fromSource ? it.srcWhy || '游戏里此刻还没有这个值（取自源码）' : it.why,
        ...(it.members?.length ? { enum: it.members } : {}),
        edit: true,
      })),
  )
}

/** 离线按类读到的 C++ 属性（VarItem）→ Details 的属性：只能看，按 UPROPERTY Category 分组，没有值 */
export function declPropsOf(groups: VarGroup[], why: string): Prop[] {
  return groups
    .filter((g) => g.src !== 'lua')
    .flatMap((g) =>
      g.items
        .filter((it) => it.kind === 'prop')
        .map((it) => ({
          name: it.path,
          displayName: it.name,
          type: it.type ?? '',
          category: it.cat || g.class || g.title,
          value: undefined,
          ...(it.note ? { help: it.note } : {}),
          readOnly: true,
          readOnlyWhy: why,
          edit: true,
        })),
    )
}
