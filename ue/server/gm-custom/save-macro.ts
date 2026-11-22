import { z } from 'zod'
import { GmMacro, type GmStore } from '../../shared/gm/schema.ts'
import type { OpCtx } from '../ops.ts'
import { writeGm } from '../store.ts'

type Obj = Record<string, unknown>

/**
 * ue_gm action=save kind=macro（GM 页梳理 F9）：存一个宏 {name, steps, onFail}，同名就改（id 不变，常用里的照样认得）。
 * 一步写 {gm: C++ GM 名} / {lua: Lua GM 名} / {console: 命令} / {custom: 自定义 GM 的名字或 id} / {wait: 秒}，args 照 run 的写法；
 * 自定义 GM 写名字时换成 id（gm.json 里按 id 存，改名后宏还认得）
 */
export async function saveMacro(ctx: OpCtx, g: GmStore, def: Obj, dryRun: boolean) {
  const name = String(def.name ?? '').trim()
  if (!name) throw new Error('kind=macro 的 def 要写 name')
  const raw = Array.isArray(def.steps) ? (def.steps as Obj[]) : []
  const steps = raw.map((s, i) => {
    if (typeof s?.custom !== 'string') return s
    const c = g.custom.find((x) => x.id === s.custom || x.name === s.custom)
    if (!c) throw new Error(`第 ${i + 1} 步的自定义 GM「${s.custom}」不存在：先 ue_gm list source=custom 看名字`)
    return { ...s, custom: c.id }
  })
  const prev = g.macros.find((m) => m.name === name)
  let m: GmMacro
  try {
    m = GmMacro.parse({ id: prev?.id ?? `m${Date.now().toString(36)}`, name, steps, onFail: def.onFail })
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}：${i.message}`).join('；') : String(e)
    throw new Error(
      `def 不合宏的写法（{name, steps: [{gm|lua|console|custom|wait, args}], onFail: stop/skip}）：${msg}`,
    )
  }
  const bad = m.steps.findIndex(
    (s) => [s.gm, s.lua, s.console, s.custom, s.wait].filter((x) => x !== undefined).length !== 1,
  )
  if (bad >= 0) throw new Error(`第 ${bad + 1} 步要写且只写 gm、lua、console、custom、wait 中的一个`)
  const base = { macro: m.name, steps: m.steps.length, ...(prev ? { updated: true } : { added: true }) }
  if (dryRun) return { dryRun: true, ...base, def: m }
  await writeGm(ctx.project, { ...g, macros: prev ? g.macros.map((x) => (x.id === m.id ? m : x)) : [...g.macros, m] })
  return { saved: true, ...base }
}
