import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import type { LuaField } from '../../../Lua.tsx'
import type { LuaRoot } from '../inspect-data.ts'
import type { LeakItem } from '../debug-types.ts'
import type { BoundObj } from './tree-model.ts'

/** 全局表里这些是 Lua 自带的库和 UnLua 自己的表，不是项目的单例和管理器：树里不列 */
const BUILTIN = new Set([
  '_G',
  'package',
  'string',
  'table',
  'math',
  'io',
  'os',
  'debug',
  'coroutine',
  'utf8',
  'bit32',
  'jit',
  'ffi',
  'UE',
  'UE4',
  'UnLua',
])

export interface ObjectsRes {
  items: BoundObj[]
  more?: boolean
  bound?: number
  stale?: number
  memoryKB?: number
}

export interface TreeData {
  objs: BoundObj[]
  globals: string[]
  modules: string[]
  meta: Omit<ObjectsRes, 'items'>
  /** 三样里哪样读失败了（UnLua 环境没建好时三样都失败，界面只显示一次） */
  errors: string[]
  /** UELink 2.19 起对象带类链：没有时按类分组只有一层、归属分组不可用 */
  rich: boolean
}

const tableKeys = (fields?: LuaField[]) =>
  (fields ?? []).filter((f) => f.t === 'table' && f.kt === 'string').map((f) => f.k)

/**
 * 树要的三样一次读齐：绑定对象（lua.objects，最多 1000 个）、全局表、package.loaded。
 * 各自失败不连累别的（没找到对象表时全局照样能看）；不轮询，刷新、跑完 GC、改完字段时 tick 变了重读
 */
export function useTreeData(tick: number) {
  const { project, target } = useUe()
  return useLoad<TreeData>(
    async () => {
      const get = (keys: string[]) =>
        op<{ fields?: LuaField[] }>(project.id, 'lua.get', { path: '', keys, offset: 0, limit: 1000 }, target)
      const [o, g, m] = await Promise.allSettled([
        op<ObjectsRes>(project.id, 'lua.objects', { limit: 1000 }, target),
        get([]),
        get(['package', 'loaded']),
      ])
      const errors = [o, g, m].flatMap((r) => (r.status === 'rejected' ? [(r.reason as Error).message] : []))
      const objs = o.status === 'fulfilled' ? o.value.items : []
      const { items: _items, ...meta } = o.status === 'fulfilled' ? o.value : { items: [] }
      return {
        objs,
        globals: g.status === 'fulfilled' ? tableKeys(g.value.fields).filter((k) => !BUILTIN.has(k)) : [],
        modules: m.status === 'fulfilled' ? tableKeys(m.value.fields) : [],
        meta,
        errors: [...new Set(errors)],
        rich: objs.some((x) => x.classChain),
      }
    },
    [project.id, target.instance, target.world, tick],
    0,
    `${project.id}/lua/tree`,
  )
}

/**
 * 右边看什么：一张 Lua 表（对象的实例表、全局、模块表，交给检视区）；一个分组（某个 Lua 类或 UE 类下的全部对象）；
 * 一个「Lua 还拿着的已销毁对象」
 */
export type LuaSel =
  | { kind: 'root'; root: LuaRoot }
  | { kind: 'group'; by: 'module' | 'class'; name: string }
  | { kind: 'leak'; item: LeakItem }
