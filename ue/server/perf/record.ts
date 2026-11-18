import { BridgeError } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { captureStatus, markCapture, startCapture, stopCapture } from '../perf.ts'
import { traceQuery } from '../trace-query.ts'
import { t } from '../util.ts'
import { progressText } from '../trace-query.ts'
import { r2, waiting } from './trace-common.ts'

/**
 * 一步录完（设计稿 4.2 的 record / wait）：Agent 原来要 start → 发命令 → mark → 等 → stop → 反复查分析好了没有，
 * 来回七八次调用。record 按 steps 顺序在一次调用里做完，stop 后等分析完（最多 waitMs）；wait 单独等录制停或分析完。
 * 步骤里的控制台命令、GM 照常走权限（运行时可写或确认），录制本身的确认在 start 时问一次。
 */

const MAX_WAIT = 120000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Step {
  console?: string
  gm?: string
  args?: unknown[]
  mark?: string
  shot?: boolean
  wait?: number
}

function parseSteps(v: unknown): Step[] {
  if (v === undefined || v === null || v === '') return []
  if (!Array.isArray(v))
    throw new BridgeError(
      t('steps 要是数组，例如 [{"mark":"开始"},{"console":"stat unit"},{"wait":5},{"mark":"结束","shot":true}]'),
    )
  return v.map((x, i) => {
    if (!x || typeof x !== 'object') throw new BridgeError(t('steps 第 {i} 项要是对象', { i: i + 1 }))
    const s = x as Step
    if (!s.console && !s.gm && !s.mark && !(Number(s.wait) > 0))
      throw new BridgeError(t('steps 第 {i} 项要写 console / gm / mark / wait 之一', { i: i + 1 }))
    return s
  })
}

/** 等分析完：录制中的 trace 追上最新也算完 */
export async function waitAnalyzed(ctx: OpCtx, id: string, ms: number) {
  const until = Date.now() + Math.min(MAX_WAIT, Math.max(0, ms))
  for (;;) {
    const res = await traceQuery(ctx, id, { what: 'info' })
    if (!waiting(res)) return { analyzed: true, seconds: r2(res.duration) }
    if (Date.now() >= until) return { analyzed: false, progress: progressText(res) }
    await sleep(1000)
  }
}

export async function recordTrace(ctx: OpCtx, a: Record<string, unknown>) {
  const steps = parseSteps(a.steps)
  // 录多久：steps 跑完就停；seconds 是上限（防止步骤卡住时一直录），默认步骤里 wait 之和 + 60
  const budget = steps.reduce((s, x) => s + (Number(x.wait) || 0), 0) + 60
  const started = (await startCapture(ctx, {
    kind: 'trace',
    seconds: a.seconds ?? Math.ceil(budget),
    label: String(a.label ?? '') || 'record',
    preset: String(a.preset ?? ''),
    channels: String(a.channels ?? ''),
    named: a.named === true,
    lua: a.lua,
  })) as { id: string; pid: number; lua?: boolean; luaNote?: string }
  const run: OpCtx = { ...ctx, target: { instance: started.pid } }
  const log: { step: number; ok: boolean; result?: unknown; error?: string }[] = []
  let failed = false
  for (const [i, s] of steps.entries()) {
    try {
      let result: unknown
      if (s.mark) result = await markCapture(ctx, s.mark, s.shot === true)
      else if (s.console) result = (await runOp(run, 'console', { command: s.console })).output
      else if (s.gm) result = await runOp(run, 'gm.run', { name: s.gm, args: s.args ?? [] })
      else await sleep(Math.min(600, Number(s.wait)) * 1000)
      log.push({
        step: i + 1,
        ok: true,
        ...(result !== undefined && !s.mark ? { result: JSON.stringify(result).slice(0, 200) } : {}),
      })
    } catch (e) {
      // 步骤失败不中断录制：已经录下的照样能分析，失败写进结果给 Agent 看
      failed = true
      log.push({ step: i + 1, ok: false, error: (e as Error).message })
    }
  }
  const stopped = (await stopCapture(ctx, started.id)) as {
    capture: { id: string; file: string; sizeKB: number }
    seconds: number
  }
  const wait = Number(a.waitMs ?? 60000)
  const analysis = wait > 0 ? await waitAnalyzed(ctx, stopped.capture.id, wait) : undefined
  return {
    capture: stopped.capture,
    seconds: stopped.seconds,
    steps: log,
    ...(failed ? { stepsNote: '有步骤失败了（见 steps），录制照常停止' } : {}),
    ...(started.luaNote ? { luaNote: started.luaNote } : {}),
    ...(analysis ? { analysis } : {}),
    next: analysis?.analyzed
      ? `ue_capture action=diagnose id=${stopped.capture.id}`
      : `ue_perf action=wait id=${stopped.capture.id} 等分析完，再 ue_capture action=diagnose`,
  }
}

/** action=wait：有 id 等这份 trace 分析完；没 id 等正在进行的录制停（到时长自动停或被别人停） */
export async function waitCapture(ctx: OpCtx, id: string, timeoutMs: number) {
  const ms = Math.min(MAX_WAIT, Math.max(1000, timeoutMs || 30000))
  if (id) {
    const r = await waitAnalyzed(ctx, id, ms)
    return {
      id,
      ...r,
      ...(r.analyzed ? { next: `ue_capture action=diagnose id=${id}` } : { next: '再调一次 wait 接着等' }),
    }
  }
  const until = Date.now() + ms
  for (;;) {
    const s = await captureStatus(ctx)
    if (!s.active.length) return { recording: false, next: 'ue_capture action=list 找刚录完的那份' }
    if (Date.now() >= until)
      return { recording: true, active: s.active, next: '还在录：再调一次 wait，或 action=stop 停掉' }
    await sleep(1000)
  }
}
