import { mapAction } from '../expand/map-action.ts'
import type { GtScript, GtStep } from '../types.ts'
import { fnRefsIn } from './check.ts'
import type { LuaFn, LuaFnStore } from './schema.ts'

export interface LuaFnIssue {
  at: string
  message: string
}

type LibEntry = { params: string[]; body: string }

/** 一组函数名 → 步骤的 lib（GameTest 2.9.0：`{名字: {params, body}}`）；找不到的记下来 */
function libOf(names: string[], fns: Map<string, LuaFn>, missing: string[]): Record<string, LibEntry> | undefined {
  const lib: Record<string, LibEntry> = {}
  for (const n of names) {
    const f = fns.get(n)
    if (!f) missing.push(n)
    else lib[n] = { params: f.params, body: f.body }
  }
  return Object.keys(lib).length ? lib : undefined
}

function withLib(s: GtStep, lib: Record<string, LibEntry> | undefined): GtStep {
  if (JSON.stringify(lib) === JSON.stringify(s.lib)) return s
  const next = { ...s }
  if (lib) next.lib = lib
  else delete next.lib
  return next
}

/**
 * 存盘、运行前把函数库里用到的函数写进步骤的 lib：脚本函数节点（luafn）带它调的那一个，
 * Lua 代码节点（lua）带代码里 `fn["库.名字"]` 用到的。函数库里删掉了的留着旧的 lib、记一条 issue（运行时照旧跑旧的）
 */
export function injectLuaFns(doc: GtScript, store: LuaFnStore): { doc: GtScript; issues: LuaFnIssue[] } {
  const issues: LuaFnIssue[] = []
  const fns = new Map(store.fns.map((f) => [f.name, f]))
  const visit = (names: (s: GtStep) => string[]) => (s: GtStep, at: string) => {
    const missing: string[] = []
    const lib = libOf(names(s), fns, missing)
    if (missing.length) {
      issues.push({ at, message: `函数库里没有 ${missing.join('、')}（被删掉或改名了？）` })
      return s
    }
    return withLib(s, lib)
  }
  let next = mapAction(
    doc,
    'luafn',
    visit((s) => (typeof s.fn === 'string' && s.fn ? [s.fn] : [])),
  )
  next = mapAction(
    next,
    'lua',
    visit((s) => (typeof s.code === 'string' ? fnRefsIn(s.code) : [])),
  )
  return { doc: next, issues }
}
