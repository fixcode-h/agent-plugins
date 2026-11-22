import { stepOk } from '../../../../shared/gm/custom.ts'
import type { GtPath, GtScript, GtStep } from '../../../../shared/gt-script/index.ts'
import type { GtStep as ReportStep } from '../gt-run/step-parts.tsx'

/**
 * 「只做这一步」交给 gt.step 的参数。以前只带 vars：步骤里写对象名或 $参数时单步一定找不到，
 * 整段跑却是好的（分析文档 B1）。objects 原样带上（GameTest 2.1.0 起认），参数取脚本里写的默认值，
 * 没有默认值的不传（UE 照常报「没定义」）
 */
export function stepTryArgs(doc: GtScript | undefined, step: GtStep): Record<string, unknown> {
  const out: Record<string, unknown> = { step }
  if (!doc) return out
  if (doc.vars && Object.keys(doc.vars).length) out.vars = doc.vars
  const params: Record<string, unknown> = {}
  for (const [k, p] of Object.entries(doc.params ?? {})) if (p?.default !== undefined) params[k] = p.default
  if (Object.keys(params).length) out.params = params
  if (doc.objects && Object.keys(doc.objects).length) out.objects = doc.objects
  return out
}

/** 一次单步的结果：右栏「运行 → 这一步」页显示（成功与否只看 ok / status，不看文字） */
export interface StepTry {
  /** 每试一次加一，同一步再试也换一份 */
  n: number
  path: GtPath
  at: string
  ms: number
  ok: boolean
  /**
   * 还在跑：带了 vars / params / objects 或是块时 GameTest 包成临时运行，同步步骤当场跑完（finished=true），
   * 要等几帧的（等界面、点击自动等待）回 finished=false，等 gt.job 推送 finished 后读报告补上结果
   */
  pending?: boolean
  runId?: string
  message?: string
  payload?: Record<string, unknown>
}

/** gt.step 的回包 → 这一步的结果 */
export function stepTryOf(path: GtPath, res: Record<string, unknown>, t0: number, n: number): StepTry {
  const runId = typeof res.runId === 'string' && res.runId ? res.runId : undefined
  const pending = !!runId && res.finished === false
  const payload = res.payload && typeof res.payload === 'object' ? (res.payload as Record<string, unknown>) : undefined
  return {
    n,
    path,
    at: new Date().toISOString(),
    ms: Date.now() - t0,
    // 不看顶层 ok：UELink 对操作成功的回包一律 ok=true，步骤没通过也是（stepOk 里写了为什么）
    ok: !pending && stepOk(res),
    ...(pending ? { pending } : {}),
    ...(runId ? { runId } : {}),
    ...(typeof res.message === 'string' && res.message ? { message: res.message } : {}),
    ...(payload ? { payload } : {}),
  }
}

/**
 * 临时运行跑完后，从它的报告里取这一步的结果：单步是唯一一条；块取块结束那一条（块本身的结果），
 * 有步骤失败时取失败的那条（它的 message、payload、证据才是要看的）
 */
export function stepTryFromReport(prev: StepTry, steps: ReportStep[]): StepTry {
  const own = steps.filter((s) => !s.setup)
  const failed = own.find((s) => s.status === 'failed')
  const pick = failed ?? [...own].reverse().find((s) => s.block) ?? own[own.length - 1]
  const ms = own.reduce((n, s) => n + (s.block ? 0 : (s.durationMs ?? 0)), 0)
  return {
    ...prev,
    pending: undefined,
    ok: !!pick && !failed && pick.status !== 'skipped',
    ms: ms || prev.ms,
    message: pick?.message || undefined,
    payload: pick?.payload,
  }
}
