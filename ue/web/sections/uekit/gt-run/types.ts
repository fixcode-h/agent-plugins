import { op, ppost } from '../../../api.ts'
import type { GtBatch } from '../GtBatch.tsx'
import type { GtStep, StepDef } from './step-parts.tsx'

/**
 * GameTest 运行相关的数据形状（gt.job、gt.runs、场景文件）和读报告。
 * 原来写在运行结果页 GtRun.tsx 里；那一页取消、功能并进整页编辑器后（设计稿 designs/GameTest整页编辑器与蓝图画布-设计稿.md），挪到这里共用
 */
export type { GtStep } from './step-parts.tsx'

export interface GtJob {
  runId?: string
  name?: string
  status: string
  busy: boolean
  total: number
  planned?: number
  failed: number
  steps: GtStep[]
  /** 批量运行（GameTest 1.2）：两个场景之间 busy 也是 true */
  batch?: GtBatch
}

export interface GtRunSummary {
  runId: string
  name: string
  /** 跑的场景文件（相对场景根，GameTest 1.2 起）：场景重名时按它认 */
  scenario?: string
  succeeded: boolean
  total: number
  failed: number
  startedAtUtc?: string
  durationMs?: number
  outputDir?: string
}

export interface GtScenarioFile {
  name?: string
  _note?: string
  stepDelayMs?: number
  /** 1 的场景里 click / type 没写 via 时是旧的代码级操作（「从这一步开始运行」要照样补上） */
  schemaVersion?: number
  steps: StepDef[]
}

/**
 * 一次运行每一步的结果：gt.report 直接回报告本身（不是 { report }）；超过 12000 字时 UE 把整份写进文件、
 * 只回 file，这时由面板读那份文件。disk：编辑器没连上，由面板从产物目录里的 report.json 读
 */
export async function loadReport(project: string, runId: string, disk: boolean): Promise<GtStep[]> {
  const r = await op<{ steps?: GtStep[]; truncated?: boolean; file?: string }>(project, 'gt.report', {
    runId,
    ...(disk ? { disk: true } : {}),
  })
  if (r.steps) return r.steps
  if (r.file) return (await ppost<{ steps?: GtStep[] }>(project, 'ext/gt/report', { file: r.file })).steps ?? []
  return []
}
