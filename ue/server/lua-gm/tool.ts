import { isEngineOwner } from '../../shared/gm/engine.ts'
import { allModules, findModule, placeOf } from '../../shared/gm/modules.ts'
import { customKey, type GmStore } from '../../shared/gm/schema.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { readGm, readLocal } from '../store.ts'
import { current } from './scan.ts'

/** 模块 id → 名字（自动的模块名字就是 id） */
const modName = (g: GmStore, id: string | undefined) => (id ? (findModule(g.modules, id)?.name ?? id) : undefined)

/**
 * ue_gm action=list 的结果：项目的 C++ GM、Lua GM 和自定义 GM 合在一起（设计稿 4.2：不加新工具，列表里多出 source 的条目）；
 * 引擎自带的 GM（CheatManager 这些类上的）只在 source=engine 时列，免得几十条引擎命令挤掉项目的。
 * C++ 要 UE 在运行，拿不到时只给一句原因，Lua 的照常列（扫描只读本机文件）；source=lua 时重新扫一次，
 * Agent 改完扫描脚本马上就能核对。source=custom 列自定义 GM、对象列表和模块名（gm.json，UE 没开也能列）
 */
export async function listGm(ctx: OpCtx, source: string, filter: string) {
  const f = filter.toLowerCase()
  const hit = (n: string) => !f || n.toLowerCase().startsWith(f)
  const res: Record<string, unknown> = {}
  const g = await readGm(ctx.project)
  if (!source || source === 'cpp' || source === 'engine') {
    try {
      const r = (await runOp(ctx, 'gm.list', {})) as { items?: { name: string; owner?: string; category?: string }[] }
      const want = source === 'engine'
      const items = (r.items ?? []).filter((i) => hit(i.name) && isEngineOwner(i.owner ?? '') === want)
      res[want ? 'engine' : 'cpp'] = want
        ? items
        : items.map((i) => ({
            ...i,
            module: modName(g, placeOf(`cpp:${i.owner}.${i.name}`, i.category || '', g).module),
          }))
    } catch (e) {
      res.cppError = (e as Error).message
    }
  }
  if (!source || source === 'lua') {
    const scan = await current(ctx.project, source === 'lua')
    if (scan.error) res.luaError = scan.error
    else if (!scan.hasScript) res.luaNote = '这个项目还没有 Lua GM 扫描脚本（GM 页「Lua GM 扫描设置」里让 AI 写）'
    if (scan.warnings.length) res.luaWarnings = scan.warnings.slice(0, 10)
    res.lua = scan.items
      .filter((i) => hit(i.name))
      .map((i) => ({
        source: 'lua',
        name: i.name,
        group: i.group || undefined,
        module: modName(g, placeOf(`lua:${i.name}`, i.group, g).module),
        desc: i.desc || undefined,
        params: i.params,
        at: `${i.file}:${i.line}`,
      }))
  }
  if (!source || source === 'custom') {
    res.custom = g.custom
      .filter((c) => hit(c.name))
      .map((c) => ({
        source: 'custom',
        key: customKey(c.id),
        name: c.name,
        module: modName(g, c.module),
        kind: c.kind,
        obj: c.obj,
        ...(c.function ? { function: c.function } : {}),
        args: c.args,
        ...(c.params?.length ? { params: c.params.map((p) => p.name) } : {}),
        ...(c.editable.length ? { editable: c.editable } : {}),
        ...(c.many !== 'error' ? { many: c.many } : {}),
        ...(c.props?.length ? { props: c.props } : {}),
        ...(c.note ? { note: c.note } : {}),
        ...(c.by ? { by: c.by } : {}),
      }))
    if (source === 'custom') {
      res.objects = g.objects
      res.modules = allModules(g, []).map((m) => m.name)
    }
  }
  // 宏和最近执行（GM 页梳理 F9）：只在点名要时列，不混进默认的列表
  if (source === 'macro')
    res.macros = g.macros
      .filter((m) => hit(m.name))
      .map((m) => ({ name: m.name, steps: m.steps, ...(m.onFail ? { onFail: m.onFail } : {}) }))
  if (source === 'recent')
    res.recent = ((await readLocal(ctx.project.id)).gmRecent ?? []).slice(0, 20).map((r) => ({
      name: r.call ? `${r.call.obj}.${r.call.fn ?? r.call.mode}` : r.name,
      key: r.key,
      ...(r.args && (Array.isArray(r.args) ? r.args.length : Object.keys(r.args).length) ? { args: r.args } : {}),
      ok: r.ok,
      ...(r.out ? { out: r.out.slice(0, 200) } : {}),
      at: new Date(r.at).toISOString(),
    }))
  if (!source)
    res.note =
      '引擎自带的 GM 用 source=engine 列；自定义 GM 的对象列表和模块名用 source=custom 看；宏用 source=macro，用户最近执行过的用 source=recent'
  return res
}
