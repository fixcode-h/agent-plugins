import { gtNames, mergeArgs, stepOf } from '../../gm/custom.ts'
import type { GmMacroStep, GmStore } from '../../gm/schema.ts'
import type { GtScript, GtStep } from '../types.ts'

/**
 * 「执行 GM」节点（GameTest 2.3.0 的 gm.run）的展开（测试页梳理第四期 4.4）：GameTest 不读面板的 gm.json，
 * 面板存盘、运行前按 GM 库把每个 gm.run 的 `run` 重新生成——脚本里存的是「哪条 GM + 这次的参数」（gm 字段），
 * run 只是缓存，GM 库里改了，下次存盘 / 运行就跟上（用户 2026-11-22 定「GM 节点默认引用」）。
 *
 * 一种 GM 一种写法（和 GM 页执行同一条路）：
 * - cpp：`api Gm.Run`（UELink 的 gm.run，Exec 函数和 GM 库函数都行）
 * - lua：`api Gm.Lua`，代码由服务端按 Lua GM 扫描结果拼好（lib.luaCode）
 * - console：`console`，参数用空格接在命令后面
 * - custom：自定义 GM 的 obj.call，用到的对象拷进脚本 objects（记在 gmObjects 里，下次展开先收掉旧的）
 * - macro：宏的每一步各展开，宏 onFail=skip 时每步 onFail: continue；等几秒写成 wait seconds
 *
 * 参数里写 `$变量`、`= 表达式`（附带 GM 里的 `$ret`）原样交给 GameTest 运行时求值；只有 Lua 和控制台的参数要拼进代码文字，不能用。
 */

export type GmKind = 'cpp' | 'lua' | 'console' | 'custom' | 'macro'
export const GM_KINDS: GmKind[] = ['cpp', 'lua', 'console', 'custom', 'macro']

/** gm.run 的 gm 字段：哪条 GM、这次的参数（C++ / Lua / 控制台按顺序，自定义 GM 按参数名）。GameTest 只读 kind、name */
export interface GmRef {
  kind: GmKind
  /** cpp：函数名；lua：Lua GM 名；console：命令；custom：自定义 GM 的 id；macro：宏的 id */
  name: string
  /** cpp 同名多处时的类 */
  owner?: string
  args?: unknown[] | Record<string, unknown>
  /** 显示用的名字（自定义 GM、宏的名字），找不到这条 GM 时报错里也用它 */
  label?: string
}

/** 展开要用的 GM 库：gm.json + 拼 Lua GM 调用代码的函数（服务端按扫描结果给；拼不出返回错误文字） */
export interface GmLib {
  gm: Pick<GmStore, 'custom' | 'macros'>
  luaCode?: (name: string, args: unknown[]) => { code: string } | { error: string }
}

type Objects = Record<string, unknown>
interface Out {
  run: GtStep[]
  objects: Objects
}

const dynamic = (v: unknown) => typeof v === 'string' && /^\s*[$=]/.test(v)
const list = (a: GmRef['args']) => (Array.isArray(a) ? a : [])

export const isGmRef = (v: unknown): v is GmRef =>
  !!v && typeof v === 'object' && typeof (v as GmRef).name === 'string' && GM_KINDS.includes((v as GmRef).kind)

/** 一条 GM → 步骤（抛错带原因：找不到、参数不能用变量、取对象的自定义 GM…） */
function expandOne(ref: GmRef, lib: GmLib, depth: number): Out {
  const args = ref.args
  switch (ref.kind) {
    case 'cpp': {
      const a: Record<string, unknown> = { name: ref.name, args: list(args) }
      if (ref.owner) a.owner = ref.owner
      return { run: [{ action: 'api', api: 'Gm.Run', args: a }], objects: {} }
    }
    case 'console': {
      const vals = list(args)
      if (vals.some(dynamic)) throw new Error(`控制台命令「${ref.name}」的参数不能用 $变量 或表达式（要拼进命令文字）`)
      const command = [ref.name, ...vals.map((v) => (typeof v === 'string' && /\s/.test(v) ? `"${v}"` : String(v)))]
      return { run: [{ action: 'console', command: command.join(' ') }], objects: {} }
    }
    case 'lua': {
      const vals = list(args)
      if (vals.some(dynamic)) throw new Error(`Lua GM「${ref.name}」的参数不能用 $变量 或表达式（要拼进 Lua 代码）`)
      if (!lib.luaCode) throw new Error(`拼不出 Lua GM「${ref.name}」的调用：没有 Lua GM 扫描结果`)
      const r = lib.luaCode(ref.name, vals)
      if ('error' in r) throw new Error(r.error)
      return { run: [{ action: 'api', api: 'Gm.Lua', args: { code: r.code, name: ref.name } }], objects: {} }
    }
    case 'custom': {
      const c = lib.gm.custom.find((x) => x.id === ref.name)
      if (!c) throw new Error(`GM 库里没有自定义 GM「${ref.label ?? ref.name}」（被删掉了？）`)
      if (c.kind === 'get') throw new Error(`自定义 GM「${c.name}」是取对象，不能放进测试；用「找对象」或检查属性`)
      const merged = mergeArgs(c, args && !Array.isArray(args) ? args : undefined)
      const { step, objects } = stepOf(c, merged)
      return { run: [step as GtStep], objects }
    }
    case 'macro': {
      if (depth > 4) throw new Error('宏套宏太深了')
      const m = lib.gm.macros.find((x) => x.id === ref.name || x.name === ref.name)
      if (!m) throw new Error(`GM 库里没有宏「${ref.label ?? ref.name}」（被删掉了？）`)
      const run: GtStep[] = []
      const objects: Objects = {}
      for (const s of m.steps) {
        const one = macroStep(s, lib, depth)
        for (const st of one.run) run.push(m.onFail === 'skip' ? { ...st, onFail: 'continue' } : st)
        Object.assign(objects, one.objects)
      }
      return { run, objects }
    }
  }
}

function macroStep(s: GmMacroStep, lib: GmLib, depth: number): Out {
  if (s.wait !== undefined) return { run: [{ action: 'wait', until: 'seconds', seconds: s.wait }], objects: {} }
  if (s.console) return expandOne({ kind: 'console', name: s.console, args: list(s.args) }, lib, depth + 1)
  if (s.custom) return expandOne({ kind: 'custom', name: s.custom, args: s.args }, lib, depth + 1)
  if (s.lua) return expandOne({ kind: 'lua', name: s.lua, args: list(s.args) }, lib, depth + 1)
  if (s.gm) return expandOne({ kind: 'cpp', name: s.gm, args: list(s.args) }, lib, depth + 1)
  return { run: [], objects: {} }
}

/** 对象参数 / 目标里 `{"$obj": 名}` 的名字按 rename 换掉 */
function renameObjs(v: unknown, rename: Map<string, string>): unknown {
  if (Array.isArray(v)) return v.map((x) => renameObjs(x, rename))
  if (!v || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  if (typeof o.$obj === 'string' && Object.keys(o).length === 1) return { $obj: rename.get(o.$obj) ?? o.$obj }
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, renameObjs(x, rename)]))
}

export interface ExpandIssue {
  /** 步骤 id（没有时是路径） */
  at: string
  message: string
}

/** gm.run 可能出现的地方：主流程、前置、守护的 do、块里的槽、附带 GM 的每组 */
function eachGmStep(doc: GtScript, visit: (s: GtStep, at: string) => GtStep): GtScript {
  const walk = (v: unknown, at: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${at}.${i}`))
    if (!v || typeof v !== 'object') return v
    const o = v as Record<string, unknown>
    // gm.run 的 run 是生成的，不往里找（宏展开出来的不会再有 gm.run）
    const next: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) next[k] = o.action === 'gm.run' && k === 'run' ? x : walk(x, `${at}.${k}`)
    return o.action === 'gm.run' ? visit(next as GtStep, typeof o.id === 'string' ? o.id : at) : next
  }
  const out: GtScript = { ...doc }
  for (const k of ['setup', 'steps', 'guards'] as const) if (doc[k] !== undefined) out[k] = walk(doc[k], k) as never
  return out
}

/**
 * 整个脚本：每个 gm.run 按 GM 库重新生成 run；自定义 GM 用到的对象拷进 objects（同名同规则复用，同名不同规则加 _2），
 * 上次展开加的（gmObjects）这次没用到的收掉。找不到这条 GM 的留着旧的 run、记一条 issue（运行时照旧跑，界面上提示）。
 * 没有 gm.run 的脚本原样返回同一个对象
 */
export function expandScript(doc: GtScript, lib: GmLib): { doc: GtScript; issues: ExpandIssue[] } {
  const issues: ExpandIssue[] = []
  const prev = Array.isArray(doc.gmObjects) ? (doc.gmObjects as string[]) : []
  const objects: Objects = { ...((doc.objects ?? {}) as Objects) }
  for (const n of prev) delete objects[n]
  const added = new Set<string>()
  let any = false
  const next = eachGmStep(doc, (s, at) => {
    any = true
    if (!isGmRef(s.gm)) {
      issues.push({ at, message: '执行 GM 没选是哪条 GM' })
      return s
    }
    try {
      const r = expandOne(s.gm, lib, 0)
      // 对象名换成 GameTest 认的、不和脚本里别的撞
      const rename = new Map<string, string>()
      const ids = gtNames(Object.keys(r.objects))
      for (const [name, val] of Object.entries(r.objects)) {
        const base = ids.get(name) ?? name
        let n = base
        for (let i = 2; n in objects && JSON.stringify(objects[n]) !== JSON.stringify(val); i++) n = `${base}_${i}`
        if (!(n in objects) || added.has(n)) {
          objects[n] = val
          added.add(n)
        }
        rename.set(base, n)
      }
      const run = r.run.map((st) => renameObjs(st, rename) as GtStep)
      return { ...s, run }
    } catch (e) {
      issues.push({ at, message: (e as Error).message })
      return s
    }
  })
  if (!any && !prev.length) return { doc, issues }
  // 原来就在 objects 里、和生成的一样的不算「加的」：下次也不收
  const mine = [...added].filter((n) => !(n in ((doc.objects ?? {}) as Objects)) || prev.includes(n))
  const out: GtScript = { ...next, objects }
  if (mine.length) out.gmObjects = mine.sort()
  else delete out.gmObjects
  // objects 原来只装着展开加的、这次都收掉了：整段去掉，不留一个空对象
  const ownOnly = Object.keys((doc.objects ?? {}) as Objects).every((n) => prev.includes(n))
  if (!Object.keys(objects).length && ownOnly) delete out.objects
  return { doc: JSON.stringify(out) === JSON.stringify(doc) ? doc : out, issues }
}
