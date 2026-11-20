import { useEffect, useState } from 'react'
import { op, ppost } from '../../../api.ts'

/**
 * gt.vars 的返回（协议第 10 节）：字段和只读函数按 C++ → 蓝图 → Lua 分组（定稿 9.4）。
 * 代码变量弹窗、对象标识弹窗、检查器的字段列表都用这一种形状
 */
export type VarSrc = 'cpp' | 'bp' | 'lua'

export interface VarItem {
  name: string
  path: string
  type?: string
  kind: 'prop' | 'fn'
  readOnly?: boolean
  sig?: string
  callable?: boolean
  why?: string
  /** 函数的参数（协议第 8 节的格式）：out 是输出参数、auto 是自动填的世界参数，都不用给 */
  args?: {
    name: string
    type?: string
    constructible?: boolean
    object?: boolean
    out?: boolean
    auto?: string
    why?: string
  }[]
  note?: string
  line?: number
  value?: unknown
  /** 像动画、计时的（Anim / Time / Tick / Hover）：默认收起变灰 */
  dim?: boolean
  /** 对象标识用：同类里各不相同 / 打分 */
  unique?: boolean
  score?: 'high' | 'mid' | 'low' | 'no'
}

export interface VarGroup {
  src: VarSrc
  title: string
  class?: string
  asset?: string
  file?: string
  /** 引擎基类（UUserWidget、AActor、UObject）默认收起 */
  collapsed?: boolean
  items: VarItem[]
}

export interface VarsReply {
  owner?: { class?: string; asset?: string; luaModule?: string }
  groups: VarGroup[]
  total?: number
  hasMore?: boolean
  truncated?: boolean
}

/** 范围：界面、玩家对象、子系统、Lua 模块、类、对象引用 */
export type VarScope =
  | { scope: 'widget'; class: string }
  | { scope: 'player'; which: 'gi' | 'gs' | 'gm' | 'ps' | 'pc' | 'pawn' | 'hud' }
  | { scope: 'subsystem'; name?: string }
  | { scope: 'lua'; module: string }
  | { scope: 'class'; name: string }
  /** GameTest 2.0：参数从定位器改成引用（协议 game-test-ref 7.6），名字引用由调用方先展开 */
  | { scope: 'object'; ref: unknown }

export const SRC_ORDER: VarSrc[] = ['cpp', 'bp', 'lua']

interface LuaFieldsReply {
  module: string
  file?: string
  items: VarItem[]
}

/**
 * 取一个范围的分组字段。编辑器开着时问 GameTest（游戏开着时带此刻的值）；界面绑了 Lua、或范围本身是 Lua 模块时，
 * 面板再扫 Lua 文件补一个 Lua 组（游戏没开时也有，类型靠注释）——和 GameTest 给的 Lua 组按路径合并，值以游戏的为准
 */
export function useVars(project: string, scope: VarScope | undefined, live: boolean) {
  const [data, setData] = useState<VarsReply>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify(scope ?? null)
  useEffect(() => {
    if (!scope) return
    let off = false
    setLoading(true)
    setError('')
    void (async () => {
      let reply: VarsReply = { groups: [] }
      if (live && scope.scope !== 'lua')
        try {
          const { scope: kind, ...rest } = scope
          reply = await op<VarsReply>(project, 'gt.vars', {
            scope: kind,
            ...rest,
            values: true,
            functions: true,
            limit: 200,
          })
        } catch (e) {
          setError((e as Error).message)
        }
      const module = scope.scope === 'lua' ? scope.module : reply.owner?.luaModule
      if (module) {
        const lua = await ppost<LuaFieldsReply>(project, 'ext/gt/luafields', { module }).catch(() => undefined)
        if (lua?.items.length) reply = mergeLua(reply, lua)
      }
      if (!off) {
        setData(reply)
        setLoading(false)
      }
    })()
    return () => {
      off = true
    }
    // key 是 scope 的内容：scope 对象每次渲染都是新的
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project, key, live])
  return { data, error, loading }
}

function mergeLua(reply: VarsReply, lua: LuaFieldsReply): VarsReply {
  const groups = [...reply.groups]
  const i = groups.findIndex((g) => g.src === 'lua')
  if (i < 0) {
    groups.push({ src: 'lua', title: lua.file ?? lua.module, file: lua.file, items: lua.items })
    return { ...reply, groups }
  }
  const have = new Map(groups[i].items.map((x) => [x.path, x]))
  for (const it of lua.items) {
    const old = have.get(it.path)
    if (old) have.set(it.path, { ...it, ...old, line: old.line ?? it.line, note: old.note ?? it.note })
    else have.set(it.path, it)
  }
  groups[i] = { ...groups[i], file: groups[i].file ?? lua.file, items: [...have.values()] }
  return { ...reply, groups }
}
