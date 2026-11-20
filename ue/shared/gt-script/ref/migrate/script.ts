import { pathStr } from '../../path.ts'
import type { GtScript } from '../../types.ts'
import { walk, walkGuards } from '../../walk.ts'
import { flushTodo, newCtx, type MigrateCtx, type MigrateTodo } from './context.ts'
import { migrateCond } from './cond.ts'
import { migrateExprsIn } from './expr.ts'
import { migrateObjects } from './objects.ts'
import { migrateStep } from './steps.ts'

/**
 * 场景 v1–v3 → v4（协议 game-test-ref 第 9 节）：纯函数，返回新场景和「迁不准」的清单（同时写进步骤 / 守护 / 引用的 todo）。
 * 已经是 v4 的原样返回、changed 为 false。不补步骤 id（存盘时 toV4 补）。
 */
export interface MigrateResult {
  doc: GtScript
  todos: MigrateTodo[]
  changed: boolean
}

export const MIGRATE_TO = 4

/** 变量初值像 v3 选择器（屏名冒号 + 路径）：只认这一种写法，免得把普通文字当选择器 */
const looksLikeOldSelector = (v: string) => /^[^\s:]+:\S*$/.test(v.trim()) && !/^https?:/i.test(v.trim())

/**
 * 存选择器的变量换掉以后，场景里还有别处用它（set 改它、拼字符串）就留着并提醒；没人用了从 vars 里拿掉
 */
function settleSelectorVars(out: GtScript, vars: Record<string, unknown>, ctx: MigrateCtx) {
  const kept: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (!ctx.selVars.has(k)) {
      kept[k] = v
      continue
    }
    const others = JSON.stringify({ ...out, vars: undefined })
    if (new RegExp(`\\$${k}(?![\\w])`).test(others)) {
      kept[k] = v
      ctx.pending.push(`变量 ${k} 存的是 v3 选择器：用作 target 的地方已换成部件写法，别处用到它的要改`)
    }
  }
  if (Object.keys(kept).length) out.vars = kept
  else if ('vars' in out) out.vars = undefined
  flushTodo(ctx, out as Record<string, unknown>, '')
  if (out.vars === undefined) Reflect.deleteProperty(out, 'vars')
}

export function migrateScript(doc: GtScript): MigrateResult {
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  if (version >= MIGRATE_TO) return { doc, todos: [], changed: false }
  const out = structuredClone(doc)
  const ctx = newCtx()
  const vars = out.vars && typeof out.vars === 'object' ? (out.vars as Record<string, unknown>) : undefined
  for (const [k, v] of Object.entries(vars ?? {}))
    if (typeof v === 'string' && looksLikeOldSelector(v)) ctx.selVars.set(k, v)
  const params = out.params && typeof out.params === 'object' ? out.params : {}
  for (const [k, p] of Object.entries(params)) {
    // 文字参数当 target 用的（call with 传选择器进来）：v3 里只能是选择器
    const d = p && typeof p === 'object' ? (p as { default?: unknown; type?: unknown }) : {}
    if (typeof d.default === 'string' || d.type === 'string') ctx.selParams.add(k)
  }
  const objects = migrateObjects(out.objects, ctx)
  if (objects) out.objects = objects
  // 先序遍历 = 文件里的顺序：find 抓的句柄先登记，后面的 @句柄 才知道落在哪个部件
  walk(out, (e) => {
    migrateStep(e.step, ctx, version)
    flushTodo(ctx, e.step, pathStr(e.path))
  })
  walkGuards(out, (g) => {
    if (g.guard.when !== undefined) g.guard.when = migrateExprsIn(migrateCond(g.guard.when, ctx), ctx)
    flushTodo(ctx, g.guard, pathStr(g.path))
  })
  if (vars && ctx.selVars.size) settleSelectorVars(out, vars, ctx)
  out.kind = out.kind ?? 'gametest-scenario'
  out.schemaVersion = MIGRATE_TO
  return { doc: out, todos: ctx.todos, changed: true }
}
