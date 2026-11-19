import type { McpResult } from '../../../sdk/server.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { str } from '../toolkit.ts'
import { mcpText } from '../util.ts'
import { retryItems } from './retry.ts'
import './actions/asset.ts'
import './actions/blueprint.ts'
import './actions/props.ts'
import { batchEntry, type BatchEntry } from './registry.ts'
import { resolveTargets } from './targets.ts'
import { readReport, type ReportStep } from './undo.ts'

/**
 * 批量执行（设计稿 designs/UE资源与蓝图批量操作-设计稿.md）：同一个工具动作作用到多个资源。
 * 展开、演练、回滚都在 UELink 里（2.14 的批量作业），面板这边只解析目标、按注册表拼参数、把结果整理成按资源的汇总。
 * 回包不超过 ~4000 字：每个资源一行，失败的在前；读的结果整体不大时直接附上，大了只给 report 文件路径
 */

/** 汇总里每个资源一行最多多少字 */
const LINE_MAX = 160
/** 读的结果整体不超过这么多字时直接附在回包里（读结构的上限） */
const INLINE_MAX = 12000
/** 汇总行合计最多多少字 */
const LINES_MAX = 3500

/** 批量自己的参数：所有能批量的工具都有，从这里拼进 schema */
export const BATCH_PROPS = {
  paths: { type: 'array', items: { type: 'string' } },
  items: { type: 'array', items: { type: 'object' } },
  select: {
    type: 'object',
    description:
      '按条件选资源，条件可组合：path 目录（默认 /Game）、class 资源类型（Blueprint、WidgetBlueprint、DataTable…）、parent 蓝图父类（含间接继承；C++ 类只认最近的那层）、prefix 名字前缀、tags 注册表标签、recursive=false 不含子目录；kind="actor" 改成按 class / tag / prefix 选关卡里的 Actor',
  },
  onError: { type: 'string', enum: ['rollback', 'keep'] },
  retry: { type: 'string' },
}

export const BATCH_HINT =
  '\n批量（多个资源做同样的读或改时一次调，别逐个调）：paths（路径数组）/ items（[{path, vars?, ...这一项的参数}]）/ select（按条件在资源注册表里选、可组合：path 目录、class 资源类型、parent 蓝图父类含间接继承、prefix 名字前缀、tags、recursive；例 select={path:"/Game/Enemies", class:"Blueprint", parent:"BP_EnemyBase"}），最多 2000 个；字符串里 {name} {path} {vars.键} 按资源替换。' +
  '写操作先整批演练、全过才真改，失败默认撤回整批（onError=keep 保留成功的）；retry=上一批的作业号 只重做没成的。select.kind="actor" 按 class / tag / prefix 选关卡里的 Actor。回包按资源汇总，全部结果在 report 文件。'

/** 一个值的一行摘要：数组给个数、短的标量原样、对象给键数 */
function brief(res: Record<string, unknown> | undefined) {
  if (!res) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(res)) {
    if (k === 'ok' || k === 'path' || k === 'instance') continue
    if (Array.isArray(v)) parts.push(`${k}=${v.length}`)
    else if (v && typeof v === 'object') {
      const status = (v as { status?: unknown }).status
      parts.push(status !== undefined ? `${k}=${status}` : `${k}{${Object.keys(v).length}}`)
    } else if (v !== undefined && String(v).length <= 40) parts.push(`${k}=${v}`)
  }
  return parts.join(' ')
}

/** 一个资源改了什么：结果里（含 bp.edit 每步、展开后的 each、DataTable 的 rows）带 prev / value 的，写成「名字: 原值 → 新值」，最多 3 条 */
export function changes(res: Record<string, unknown> | undefined, max = 3) {
  const found: string[] = []
  const v = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x))
  const walk = (o: unknown, label: string) => {
    if (found.length > max || !o || typeof o !== 'object') return
    if (Array.isArray(o)) return o.forEach((x) => walk(x, label))
    const r = o as Record<string, unknown>
    const name = String(r.row ?? r.name ?? r.prop ?? label)
    if ('prev' in r && ('value' in r || r.skipped)) {
      found.push(
        (r.skipped ? `${name}: 跳过（当前 ${v(r.prev)}）` : `${name}: ${v(r.prev)} → ${v(r.value)}`).slice(0, 120),
      )
      return
    }
    for (const k of ['results', 'each', 'rows']) if (k in r) walk(r[k], name)
  }
  walk(res, '')
  return found.length > max ? [...found.slice(0, max), '…'] : found
}

/** 把 UELink 的批量回包整理给 Agent */
export async function formatBatch(res: Record<string, unknown>, write: boolean) {
  const b = (res.batch ?? {}) as Record<string, unknown>
  const report = await readReport(res.report)
  const steps = report?.steps ?? []
  // 每个资源最后一步有结果的（编译 > 改 / 读），拿来写一行摘要
  const byItem = new Map<number, ReportStep>()
  // 演练的结果先放，有真改的再盖上：只演练时也能看到改前改后
  for (const s of steps)
    if (s.item !== undefined && s.state === 'ok' && s.phase !== 'undo' && (s.phase !== 'dryRun' || !byItem.has(s.item)))
      byItem.set(s.item, s)
  const list = (b.list as { path: string; item?: number; state: string; error?: string }[]) ?? []
  const lines: string[] = []
  let used = 0
  for (const [i, it] of list.entries()) {
    // item 是资源序号（UELink 2.14 把失败的排在前面，列表下标不等于序号）；没有 item 时按下标
    const step = byItem.get(it.item ?? i)
    const diff = step ? changes(step.result).join('；') : ''
    const line =
      `${it.path}  ${it.state}${it.error ? `  ${it.error}` : diff ? `  ${diff}` : step ? `  ${brief(step.result)}` : ''}`.slice(
        0,
        LINE_MAX,
      )
    if (used + line.length > LINES_MAX) {
      lines.push(`…还有 ${list.length - lines.length} 个没列出（看 report 文件）`)
      break
    }
    used += line.length
    lines.push(line)
  }
  const counts = Object.fromEntries(
    ['ok', 'failed', 'skipped', 'rolledBack', 'dryRunOk', 'pending'].filter((k) => b[k]).map((k) => [k, b[k]]),
  )
  const outObj: Record<string, unknown> = {
    job: res.id,
    status: res.status,
    items: b.items,
    ...counts,
    ...(b.stopped
      ? { stopped: b.stopped === 'dryRun' ? '演练有失败，整批没有改' : '真改有失败，已撤回这批改好的' }
      : {}),
    lines,
    report: res.report,
    ...(res.history ? { history: res.history } : {}),
  }
  // 读的：结果整体不大就直接附上，省得 Agent 再去读文件
  if (!write) {
    const results: Record<string, unknown> = {}
    for (const s of byItem.values()) results[String(s.args?.path)] = s.result
    const text = JSON.stringify(results)
    if (text.length <= INLINE_MAX) outObj.results = results
    else outObj.note = `结果有 ${text.length} 字，没有附上：按 report 文件里 steps[].result 看，或对单个资源再调`
  }
  return outObj
}

function opOf(e: BatchEntry, a: Record<string, unknown>) {
  return typeof e.op === 'function' ? e.op(a) : e.op
}

/** 工具处理函数里调：参数里有批量写法时接手；这个动作不支持批量时回一句报错 */
export async function runBatch(tool: string, a: Record<string, unknown>, ctx: OpCtx): Promise<McpResult> {
  const e = batchEntry(tool, a.action)
  if (!e)
    return mcpText(`${tool}${a.action ? ` action=${a.action}` : ''} 不支持批量（paths / items / select），逐个调`, true)
  if (a.retry) return retryBatch(str(a.retry), e, a, ctx)
  const targets = await resolveTargets(a, ctx)
  const args = {
    ...e.args(a),
    ...targets,
    ...(a.onError ? { onError: a.onError } : {}),
    ...(a.dryRunFirst === false ? { dryRunFirst: false } : {}),
  }
  const res = await runOp(ctx, opOf(e, a), args, e.timeoutMs, { job: true })
  return finishBatch(res, e)
}

/** 批量结果收尾：没做完回作业号；做完了整理汇总（Agent 带 job 再调时也走这里） */
export async function finishBatch(res: Record<string, unknown>, e: BatchEntry | undefined) {
  if (!res.batch) return mcpText(JSON.stringify(res, null, 1))
  return mcpText(JSON.stringify(await formatBatch(res, !!e?.write), null, 1))
}

/** Agent 带 job 再调：批量作业的结果同样整理成汇总，普通作业原样给出 */
export async function jobResult(res: Record<string, unknown>, tool: string, action: unknown) {
  if (!res.batch) return mcpText(JSON.stringify(res, null, 1))
  return finishBatch(res, batchEntry(tool, action))
}

/** 只重做上一批没成的（失败、跳过、被回滚的）：参数照上一批每个资源实际用的，onError 可以重新给 */
async function retryBatch(job: string, e: BatchEntry, a: Record<string, unknown>, ctx: OpCtx) {
  const { op, items } = await retryItems(ctx.project.root, job)
  if (!items.length) return mcpText(`作业 ${job} 里没有要重做的资源：都成功了`)
  const res = await runOp(ctx, op, { items, ...(a.onError ? { onError: a.onError } : {}) }, e.timeoutMs, { job: true })
  return finishBatch(res, e)
}
