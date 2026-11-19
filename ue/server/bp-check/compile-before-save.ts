import { batchEntry } from '../batch/registry.ts'
import { readReport } from '../batch/undo.ts'
import { runOp, type OpCtx } from '../ops.ts'

/**
 * ue_save compile=true：保存前先把要保存的蓝图一起编一遍（UELink 2.14 的批量 bp.compile），有没通过的就整批不保存，
 * 把错误交给 Agent 修。改、编译、保存连成一次调用；写盘仍只经 ue_save（面板的守卫和改动记录都认它）。
 * 不是蓝图的包（DataTable、贴图……）编译时报「不是蓝图」，不算失败
 */

/** 和 hook.ts 一样：桥接对非蓝图资源的报错 */
const NOT_BP = /不是蓝图/

export interface CompileGate {
  /** 可以保存 */
  ok: boolean
  /** 不能保存时给 Agent 的说明 */
  message?: string
  compiled?: number
}

export async function compileBeforeSave(ctx: OpCtx, packages: string[]): Promise<CompileGate> {
  let pkgs = packages
  if (!pkgs.length) {
    const dirty = (await runOp(ctx, 'asset.dirty', {})) as { items?: { package: string }[] }
    pkgs = (dirty.items ?? []).map((i) => i.package).filter((p) => p.startsWith('/Game/'))
  }
  if (!pkgs.length) return { ok: true, compiled: 0 }
  const res = await runOp(ctx, 'bp.compile', { paths: pkgs, onError: 'keep' }, 1800000, { job: true })
  if (!res.batch)
    return {
      ok: false,
      message: `蓝图还在编译（作业 ${res.job}），没有保存：用 ue_compile job=${res.job} 等结果，通过后再 ue_save`,
    }
  const report = await readReport(res.report)
  const steps = report?.steps ?? []
  batchEntry('ue_compile')?.after?.(ctx, steps)
  const bad: string[] = []
  let compiled = 0
  for (const s of steps) {
    const status = (s.result?.compile as { status?: string; errors?: number } | undefined)?.status
    if (s.state === 'failed' && NOT_BP.test(s.error ?? '')) continue
    compiled++
    if (s.state === 'failed') bad.push(`- ${s.args?.path}：${s.error}`)
    else if (status === 'error')
      bad.push(`- ${s.args?.path}：编译出错（看 ${res.report} 里这一步的 compile，或单独 ue_compile）`)
  }
  if (bad.length)
    return {
      ok: false,
      message: `有 ${bad.length} 个蓝图没编过，整批没有保存：\n${bad.slice(0, 20).join('\n')}\n修好后再 ue_save（compile=true）`,
      compiled,
    }
  return { ok: true, compiled }
}
