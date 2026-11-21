import { runOp, type OpCtx } from '../ops.ts'
import { parseLuaPath } from '../luapath.ts'
import { out, str } from '../toolkit.ts'
import { mcpText } from '../util.ts'

/**
 * ue_lua 的 2.4 动作（设计稿「UE 插件优化与扩展」二 P0「Lua 改完能验」、四.1）：check / reload / modules / errors / call。
 * 都是 UELink 2.4 的新操作，旧桥接调到时 runOp 原样报「没有这个操作，更新 UELink」。
 * Agent 的循环：改文件 → check → reload → 触发（ue_gm / call）→ errors 看有没有新报错
 */
export const LUA_DEV_ACTIONS = ['check', 'reload', 'modules', 'errors', 'call'] as const

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])

export async function luaDevAction(a: Record<string, unknown>, ctx: OpCtx) {
  switch (a.action) {
    case 'check': {
      const files = list(a.files)
      if (!files.length && !a.code) return mcpText('check 要给 files（.lua 文件路径，相对项目目录）或 code', true)
      return out(await runOp(ctx, 'lua.check', { files, ...(a.code ? { code: str(a.code) } : {}) }, 60000))
    }
    case 'reload': {
      const modules = list(a.modules)
      if (!modules.length && !a.changed) return mcpText('reload 要给 modules（模块名）或 changed=true', true)
      return out(await runOp(ctx, 'lua.reload', { modules, changed: !!a.changed }, 60000))
    }
    case 'modules': {
      // 默认只回改过还没重载的：全量模块表可能上千个，Agent 要的是「哪些该重载」
      const r = (await runOp(ctx, 'lua.modules', { filter: str(a.filter), limit: 2000 })) as {
        items?: { stale?: boolean }[]
        total?: number
        stale?: number
        root?: string
      }
      const items = r.items ?? []
      const shown = a.all || a.filter ? items.slice(0, 200) : items.filter((m) => m.stale)
      return out({ total: r.total, stale: r.stale, root: r.root, items: shown })
    }
    case 'errors':
      return out(
        await runOp(ctx, 'lua.errors', {
          since: Number(a.since) || 0,
          limit: Math.min(Number(a.limit) || 20, 100),
          clear: !!a.clear,
        }),
      )
    case 'call': {
      const keys = parseLuaPath(str(a.lua))
      if (!keys.length) return mcpText('call 要给 lua（函数路径，例如 BagSystem.AddItem）', true)
      const timeoutMs = Math.min(Math.max(Number(a.timeoutMs) || 10000, 100), 60000)
      return out(
        await runOp(
          ctx,
          'lua.call',
          { path: a.path ?? '', keys, self: !!a.self, args: Array.isArray(a.args) ? a.args : [], timeoutMs },
          timeoutMs + 10000,
        ),
      )
    }
    default:
      return undefined
  }
}

/**
 * ue_find kind=lua：绑了 Lua 的对象（lua.objects）；给了模块名时再找这个 Lua 类的纯 Lua 实例（lua.instances，UELink 2.20 起，
 * 用户 2026-11-21：Lua 框架自己 new 的表也要能找到）。旧 UELink 没有 lua.instances 时只回绑定对象
 */
export async function findLua(a: Record<string, unknown>, ctx: OpCtx, limit: number) {
  const bound = await runOp(ctx, 'lua.objects', { class: a.class, prefix: a.prefix, module: a.module, limit })
  const module = str(a.module).trim()
  if (!module || a.class || a.prefix) return bound
  const pure = await runOp(ctx, 'lua.instances', { module, limit }, 60000).catch((e: Error) =>
    /lua\.instances/.test(e.message) ? undefined : { error: e.message },
  )
  return pure ? { ...bound, pure } : bound
}
