import { z } from 'zod'

/**
 * GameTest 的 Lua 函数库（用户 2026-11-28）：测试要用的 Lua 只能写在节点里或这里，不往游戏项目里加 .lua 文件、
 * 不存成 .lua 文件。这里是一组普通函数（`库.名字` → 参数名 + 函数体），**不许有类结构**；函数体里可以 require 项目已有模块。
 * 存在文档根的 AgentPanel/UE/gametest-lua.json（和 gm.json 同一个目录，能提交、团队共用），GameTest 不读它：
 * 面板存盘、运行前把用到的函数写进步骤的 lib（luafn/inject.ts）
 */
export const LUAFN_VERSION = 1

/** `库.名字`：库和名字都是字母、数字、下划线或中文，不以数字开头 */
export const LUAFN_NAME = /^[\p{L}_][\p{L}\p{N}_]*\.[\p{L}_][\p{L}\p{N}_]*$/u
/** Lua 的参数名 */
export const LUA_PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/

export const LuaFn = z.object({
  name: z.string().regex(LUAFN_NAME, '函数名写成「库.名字」，例如 背包.加物品'),
  params: z.array(z.string().regex(LUA_PARAM, '参数名只能是英文字母、数字、下划线')).max(16).default([]),
  /** 函数体（不含 function 头和 end），最后 return 结果 */
  body: z.string().max(20000),
  /** 一句话说明：做什么、返回什么（编辑页的下拉、Agent 看的清单都显示） */
  note: z.string().max(500).optional(),
})
export type LuaFn = z.infer<typeof LuaFn>

export const LuaFnStore = z.object({
  kind: z.literal('gametest-lua').default('gametest-lua'),
  version: z.literal(LUAFN_VERSION).default(LUAFN_VERSION),
  fns: z.array(LuaFn).max(500).default([]),
})
export type LuaFnStore = z.infer<typeof LuaFnStore>

export const emptyLuaFnStore = (): LuaFnStore => ({ kind: 'gametest-lua', version: LUAFN_VERSION, fns: [] })

/** 读到的文件 → 函数库（格式不对的整份当空的，错误交给调用方显示） */
export function parseLuaFnStore(raw: unknown): { store: LuaFnStore; error?: string } {
  if (raw === null || raw === undefined) return { store: emptyLuaFnStore() }
  const r = LuaFnStore.safeParse(raw)
  if (r.success) return { store: r.data }
  return { store: emptyLuaFnStore(), error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；') }
}
