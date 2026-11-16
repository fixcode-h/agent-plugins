import { runOp, type OpCtx } from '../ops.ts'
import { current } from './scan.ts'

/**
 * ue_gm action=list 的结果：C++ GM 和 Lua GM 合在一起（设计稿 4.2：不加新工具，列表里多出 source: lua 的条目）。
 * C++ 要 UE 在运行，拿不到时只给一句原因，Lua 的照常列（扫描只读本机文件）；source=lua 时重新扫一次，
 * Agent 改完扫描脚本马上就能核对
 */
export async function listGm(ctx: OpCtx, source: string, filter: string) {
  const f = filter.toLowerCase()
  const hit = (n: string) => !f || n.toLowerCase().startsWith(f)
  const res: Record<string, unknown> = {}
  if (source !== 'lua') {
    try {
      const r = (await runOp(ctx, 'gm.list', {})) as { items?: { name: string }[] }
      res.cpp = (r.items ?? []).filter((i) => hit(i.name))
    } catch (e) {
      res.cppError = (e as Error).message
    }
  }
  if (source !== 'cpp') {
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
        desc: i.desc || undefined,
        params: i.params,
        at: `${i.file}:${i.line}`,
      }))
  }
  return res
}
