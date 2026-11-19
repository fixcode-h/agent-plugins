import { readReport } from '../batch/undo.ts'
import { runOp, type OpCtx } from '../ops.ts'

/**
 * ue_save（默认，compile=false 才跳过）：保存前先把要保存的蓝图一起编一遍（UELink 2.14 的批量 bp.compile），有没通过的就整批不保存，
 * 把错误交给 Agent 修。
 * 先编译后保存而不是存完再编：保存时 P4 会签出进变更列表，编不过的版本一旦写盘就进了版本管理的改动里。
 * 改、编译、保存连成一次调用；写盘仍只经 ue_save（面板的守卫和改动记录都认它）。
 * 不是蓝图的包（DataTable、贴图……）编译时报「不是蓝图」，不算失败
 */

/** 桥接对非蓝图资源的报错（AgentPanelEditorShared.cpp 的 LoadBlueprint：「X 不是蓝图（是 Y）」） */
const NOT_BP = /不是蓝图/
/** long-ops.ts 的 runAsJob 对旧桥接（没有批量）的报错 */
const NO_BATCH = /不支持批量/

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
  let res: Record<string, unknown>
  try {
    res = await runOp(ctx, 'bp.compile', { paths: pkgs, onError: 'keep' }, 1800000, { job: true })
  } catch (e) {
    // UELink 2.14 之前没有批量编译：逐个编，保存前编译不能因为桥接旧就跳过
    if (!NO_BATCH.test((e as Error).message)) throw e
    return gate(await compileOneByOne(ctx, pkgs))
  }
  if (!res.batch)
    return {
      ok: false,
      message: `蓝图还在编译（作业 ${res.job}），没有保存：用 ue_compile job=${res.job} 等结果，通过后再 ue_save`,
    }
  const report = await readReport(res.report)
  const bad: string[] = []
  let compiled = 0
  for (const s of report?.steps ?? []) {
    const status = (s.result?.compile as { status?: string } | undefined)?.status
    if (s.state === 'failed' && NOT_BP.test(s.error ?? '')) continue
    compiled++
    if (s.state === 'failed') bad.push(`- ${s.args?.path}：${s.error}`)
    else if (status === 'error')
      bad.push(`- ${s.args?.path}：编译出错（看 ${res.report} 里这一步的 compile，或单独 ue_compile）`)
  }
  return gate({ bad, compiled })
}

/** 旧桥接：一个包一个包编，有没编过的照样整批不存 */
async function compileOneByOne(ctx: OpCtx, pkgs: string[]) {
  const bad: string[] = []
  let compiled = 0
  for (const path of pkgs) {
    let r: Record<string, unknown>
    try {
      r = await runOp(ctx, 'bp.compile', { path }, 300000)
    } catch (e) {
      const msg = (e as Error).message
      if (NOT_BP.test(msg)) continue
      compiled++
      bad.push(`- ${path}：${msg.slice(0, 300)}`)
      continue
    }
    compiled++
    const c = r.compile as { status?: string; errors?: number } | undefined
    if (!c) bad.push(`- ${path}：还在编译（作业 ${r.job}），用 ue_compile job=${r.job} 等结果`)
    else if (c.status === 'error') bad.push(`- ${path}：${c.errors ?? ''} 个编译错误（ue_compile path=${path} 看节点）`)
  }
  return { bad, compiled }
}

function gate({ bad, compiled }: { bad: string[]; compiled: number }): CompileGate {
  if (bad.length)
    return {
      ok: false,
      message: `有 ${bad.length} 个蓝图没编过，整批没有保存：\n${bad.slice(0, 20).join('\n')}\n修好后再 ue_save`,
      compiled,
    }
  return { ok: true, compiled }
}
