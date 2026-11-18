import type { OpCtx } from '../../ops.ts'
import { liveCards } from '../../instances.ts'
import { scenarioRoot } from '../gt-disk.ts'
import { readApiFile, writeLuaApi } from './api-file.ts'
import { luaRoot } from './lua-files.ts'
import { luaGroup, mergeLuaGroups, type VarGroup } from './lua-vars.ts'
import { validateScript } from './validate.ts'

/**
 * ue_gametest 给 Agent「不录制、从代码写回放」的四个 action（定稿 11 节、GameTest 脚本协议 10 节）：
 * vars（变量和函数签名，按 C++ / 蓝图 / Lua 分组）、widgets（读 WBP 资产的控件树）、api（接口库）、validate（不开游戏校验）。
 * C++ / 蓝图那部分只有编辑器知道（gt.vars / gt.widgets / gt.api / gt.validate，GameTest 1.9.0 起），
 * Lua 那部分面板按文件扫（游戏没开也有），两边拼成同一个结构交给 Agent。
 */
export type Op = (name: string, args: Record<string, unknown>, timeout?: number) => Promise<Record<string, unknown>>
type A = Record<string, unknown>

/** 和 ADR 0067 一致：读结构的最多 12000 字 */
export const STRUCT_MAX = 12000
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d)
const s = (v: unknown) => (typeof v === 'string' ? v : '')

const editorOpen = async (ctx: OpCtx) => (await liveCards(ctx.project.root)).some((x) => x.kind === 'editor' || x.kind === 'game')

/** 旧版 GameTest 不认新操作：说清楚要升级，不把「未知操作」原样丢给 Agent */
function needNew(e: unknown, op: string): never {
  const msg = (e as Error).message
  if (/unknown|不认识|未知|not found|没有.*操作/i.test(msg))
    throw new Error(`编辑器里的 GameTest 不认 ${op}：在 UE 页「UE 插件」把 GameTest 升到 1.9.0 以上并重新编译（原始错误：${msg}）`)
  throw e
}

async function tryOp(op: Op, name: string, args: A, timeout?: number) {
  try {
    return await op(name, args, timeout)
  } catch (e) {
    return needNew(e, name)
  }
}

/** 超过上限时从 Lua 组尾部砍（C++ 那边自己分过页），标 truncated，至少留一项 */
function fit(res: A, lua: VarGroup | undefined) {
  if (!lua) return res
  const groups = [...((res.groups as VarGroup[] | undefined) ?? []).filter((g) => g.src !== 'lua'), lua]
  const out: A = { ...res, groups }
  while (JSON.stringify(out).length > STRUCT_MAX && lua.items.length > 1) {
    lua.items = lua.items.slice(0, Math.max(1, Math.floor(lua.items.length * 0.7)))
    out.truncated = true
    out.hint = 'Lua 组太长截掉了后面的：加 filter 按名字筛'
  }
  return out
}

export async function gtVars(op: Op, a: A, ctx: OpCtx) {
  const root = luaRoot(ctx.project)
  const scope = s(a.scope) || 'widget'
  const filter = s(a.filter)
  const args: A = {
    scope,
    ...Object.fromEntries(['target', 'class', 'name', 'which', 'module', 'filter'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
    ...(a.object !== undefined ? { object: a.object } : {}),
    values: a.values !== false,
    functions: a.functions !== false,
    offset: num(a.offset, 0),
    limit: Math.min(num(a.limit, 60), 200),
  }
  // 只看 Lua 模块：游戏不开也能列（文件扫描），开着再让 UE 按模块表补值
  if (scope === 'lua') {
    const mod = s(a.module)
    if (!mod) return { error: 'scope=lua 要给 module（require 路径，如 Game.Guide.GuideMgr）' }
    const file = await luaGroup(root, mod, `@luaMod.${mod}.`, filter)
    let game: A | undefined
    if (await editorOpen(ctx)) game = await op('gt.vars', args).catch(() => undefined)
    const fromGame = (game?.groups as VarGroup[] | undefined)?.find((g) => g.src === 'lua')
    const merged = mergeLuaGroups(file, fromGame)
    if (!merged) return { error: `找不到 Lua 模块 ${mod}：脚本根是 ${root.replace(/\\/g, '/')}，module 写相对它的 require 路径` }
    return fit({ owner: { luaModule: mod }, groups: [], ...(game && !game.error ? { valuesFrom: 'game' } : {}) }, merged)
  }
  if (!(await editorOpen(ctx)))
    return { error: '列 C++ 和蓝图的字段要编辑器开着（读反射）；只要 Lua 的用 scope=lua module=…', offline: true }
  const res = await tryOp(op, 'gt.vars', args)
  // 界面绑了 Lua 模块、UE 又没给 Lua 组（游戏没开，没有实例表）：按文件补上
  const owner = (res.owner ?? {}) as { luaModule?: string }
  const groups = (res.groups as VarGroup[] | undefined) ?? []
  if (owner.luaModule && num(a.offset, 0) === 0) {
    const file = await luaGroup(root, owner.luaModule, scope === 'widget' ? '@lua.' : `@luaMod.${owner.luaModule}.`, filter)
    return fit(res, mergeLuaGroups(file, groups.find((g) => g.src === 'lua')))
  }
  return res
}

export async function gtWidgets(op: Op, a: A, ctx: OpCtx) {
  if (!a.asset && !a.class) return { error: '给 asset（WBP 资产路径，如 /Game/UI/WBP_Bag）或 class' }
  if (!(await editorOpen(ctx))) return { error: '读 WBP 的控件树要编辑器开着（不用开游戏）', offline: true }
  return tryOp(op, 'gt.widgets', {
    ...(a.asset ? { asset: a.asset } : { class: a.class }),
    ...(a.filter ? { filter: a.filter } : {}),
    offset: num(a.offset, 0),
    limit: Math.min(num(a.limit, 200), 400),
  })
}

/**
 * 接口库：先把 Lua 接口扫一遍写进 _api.json（没变不写），编辑器开着时由 gt.api 统一列（自带 + C++ + Lua），
 * 编辑器没开时只能从 _api.json 列项目接口，自带接口说明要编辑器
 */
export async function gtApi(op: Op, a: A, ctx: OpCtx) {
  const scen = await scenarioRoot(ctx.project.root)
  const lua = await writeLuaApi(scen, luaRoot(ctx.project)).catch((e: Error) => ({ error: e.message }))
  const scanNote = 'error' in lua ? { luaScanError: lua.error } : lua.missing ? { luaMissingFolders: lua.missing } : {}
  const args = {
    ...Object.fromEntries(['query', 'category', 'src', 'readOnly'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
    offset: num(a.offset, 0),
    limit: Math.min(num(a.limit, 60), 200),
  }
  if (await editorOpen(ctx)) {
    if (a.rescan === true) await tryOp(op, 'gt.api.scan', {}, 120000)
    return { ...(await tryOp(op, 'gt.api', args)), ...scanNote }
  }
  return { ...offlineApi(await readApiFile(scen), args), ...scanNote, offline: true }
}

/** 编辑器没开：从 _api.json 列项目接口，筛选和分页照 gt.api 的参数 */
export function offlineApi(doc: A, a: A) {
  type Item = A & { name: string; src: string; readOnly?: boolean; category?: string; note?: string }
  const items: Item[] = []
  for (const src of ['cpp', 'lua']) {
    const sec = doc[src] as { items?: A[] } | undefined
    for (const x of sec?.items ?? []) items.push({ ...x, src } as Item)
  }
  const q = s(a.query).toLowerCase()
  const hit = items.filter(
    (x) =>
      (!a.src || a.src === x.src) &&
      (a.readOnly === undefined || !!x.readOnly === a.readOnly) &&
      (!a.category || x.category === a.category) &&
      (!q || `${x.name} ${x.note ?? ''}`.toLowerCase().includes(q)),
  )
  const offset = num(a.offset, 0)
  const limit = num(a.limit, 60)
  const page = hit.slice(offset, offset + limit)
  return {
    items: page,
    total: hit.length,
    hasMore: offset + limit < hit.length,
    ...(offset + limit < hit.length ? { nextOffset: offset + limit } : {}),
    note: '编辑器没开：只列 _api.json 里的项目接口；自带接口（Object.* / Widget.* …）的清单要编辑器开着才能取',
  }
}

export async function gtValidate(op: Op, a: A, ctx: OpCtx) {
  return validateScript(op, a, ctx, await editorOpen(ctx))
}
