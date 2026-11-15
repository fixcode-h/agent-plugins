import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runOp, type OpCtx } from './ops.ts'

/**
 * ue_get 的两种「多取」（2026-11-15 用户要 Agent 能读一个 UObject 的整个数据、读某个变量）：
 * - dumpObject：整个对象（或一个属性的完整值）不截断写成文件，只回路径和条数。整份属性常常几万字，
 *   直接塞进回复会撑满上下文（ADR 0067：长内容写文件只回路径），Agent 再用自己的读文件 / 搜索看需要的部分。
 * - readProps：一次读几个变量，免得 Agent 为了看三个数调三次工具。
 * 都只用桥接现有的 props / get / components（maxChars=0 表示不截断），旧桥接也能用，不用改 C++。
 */

/** 一份导出里最多带多少个组件：大 Actor 几百个组件，再多就让 Agent 按组件路径单独导 */
const MAX_COMPONENTS = 64
/** dump 目录只留最近这么多份，免得反复导出把 Saved 塞满 */
const KEEP_FILES = 30
const MAX_PROPS = 30

interface DumpOpts {
  prop?: string
  filter?: string
  /** Actor 的组件一起导（默认带） */
  components?: boolean
}

type Item = { path?: string; name?: string; class?: string }

export async function dumpObject(ctx: OpCtx, objPath: string, opts: DumpOpts) {
  let data: Record<string, unknown>
  let summary: Record<string, unknown>
  if (opts.prop) {
    const r = await runOp(ctx, 'get', { path: objPath, prop: opts.prop, maxChars: 0 })
    data = { path: objPath, prop: opts.prop, type: r.type, value: r.value }
    summary = { prop: opts.prop, type: r.type }
  } else {
    const r = await runOp(ctx, 'props', { path: objPath, filter: opts.filter ?? '', maxChars: 0 })
    const props = (r.props as unknown[]) ?? []
    data = { object: r.object, kind: r.kind, props }
    summary = { object: r.object, kind: r.kind, props: props.length }
    if (opts.components !== false) {
      const comps = await componentsOf(ctx, objPath)
      if (comps) {
        data.components = comps.items
        summary.components = comps.items.length
        if (comps.more) summary.componentsMore = comps.more
      }
    }
  }
  const text = JSON.stringify(data, null, 1)
  const file = await save(ctx, objPath, opts.prop, text)
  return {
    file,
    chars: text.length,
    ...summary,
    note: '完整内容在 file 里（JSON），用读文件或搜索看需要的部分；对象引用只有路径，要看就用那个路径再导',
  }
}

/** 不是 Actor（组件、子系统、资源默认值以外的对象）时桥接报错，就当没有组件 */
async function componentsOf(ctx: OpCtx, objPath: string) {
  let list: Item[]
  try {
    const r = await runOp(ctx, 'components', { path: objPath })
    list = (r.items as Item[]) ?? []
  } catch {
    return undefined
  }
  if (!list.length) return undefined
  const items: Record<string, unknown>[] = []
  for (const c of list.slice(0, MAX_COMPONENTS)) {
    if (!c.path) continue
    try {
      const r = await runOp(ctx, 'props', { path: c.path, filter: '', maxChars: 0 })
      items.push({ path: c.path, name: c.name, class: c.class, props: r.props ?? [] })
    } catch (e) {
      // 一个组件读不了不影响别的，原因原样留在导出里
      items.push({ path: c.path, name: c.name, class: c.class, error: (e as Error).message })
    }
  }
  return { items, more: Math.max(list.length - MAX_COMPONENTS, 0) }
}

async function save(ctx: OpCtx, objPath: string, prop: string | undefined, text: string) {
  const dir = path.join(ctx.project.root, 'Saved', 'AgentPanel', 'dump')
  await mkdir(dir, { recursive: true })
  // 文件名取对象名（路径最后一段）+ 属性名，Windows 不认的字符换掉
  const base = `${objPath.split(/[/.:]/).filter(Boolean).pop() || 'object'}${prop ? `-${prop}` : ''}`
    .replace(/[^\w\-[\]]+/g, '_')
    .slice(0, 80)
  const file = path.join(dir, `${base}-${Date.now()}.json`)
  await writeFile(file, text, 'utf8')
  await prune(dir)
  return file
}

async function prune(dir: string) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  if (names.length <= KEEP_FILES) return
  const withTime = await Promise.all(
    names.map(async (n) => ({ n, t: (await stat(path.join(dir, n)).catch(() => undefined))?.mtimeMs ?? 0 })),
  )
  withTime.sort((a, b) => b.t - a.t)
  await Promise.all(withTime.slice(KEEP_FILES).map((x) => rm(path.join(dir, x.n), { force: true })))
}

/** 一次读几个属性：每个单独取，一个读不了不影响别的 */
export async function readProps(ctx: OpCtx, objPath: string, props: unknown[]) {
  const list = props.map(String).filter(Boolean)
  if (list.length > MAX_PROPS) throw new Error(`一次最多读 ${MAX_PROPS} 个属性，要全部就用 file=true 导出整个对象`)
  const items = []
  for (const prop of list) {
    try {
      const r = await runOp(ctx, 'get', { path: objPath, prop, maxChars: 2000 })
      items.push({ prop, type: r.type, value: r.value })
    } catch (e) {
      items.push({ prop, error: (e as Error).message })
    }
  }
  return { path: objPath, items }
}
