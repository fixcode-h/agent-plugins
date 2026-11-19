import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { readReport } from './undo.ts'

/**
 * 只重做上一批没成的（batch/run.ts 的 retry）：从 UE 的作业结果文件（Saved/UELink/jobs/<作业号>.json）里
 * 挑出失败、跳过、被回滚的资源，用它们上次实际的参数（占位符已经换好）重新组成 items
 */
export async function retryItems(root: string, job: string) {
  if (!/^[\w.-]+$/.test(job)) throw new BridgeError(`retry 要给上一批的作业号（如 uelink-12），收到「${job}」`)
  const file = path.join(root, 'Saved', 'UELink', 'jobs', `${job}.json`)
  const report = (await readReport(file)) as
    | { steps: { item?: number; phase?: string; args?: Record<string, unknown> }[]; batch?: Record<string, unknown> }
    | undefined
  if (!report?.batch) throw new BridgeError(`找不到批量作业 ${job} 的结果文件（${file}）：UE 只留最近 50 份`)
  const list = (report.batch.list as { state: string }[]) ?? []
  const op = String(report.batch.op ?? '')
  const items: Record<string, unknown>[] = []
  for (const it of list as { state: string; item?: number }[]) {
    const i = Number(it.item ?? -1)
    if (it.state === 'ok' || it.state === 'dryRunOk') continue
    // 优先取真改那一步的参数；演练就失败的只有演练那一步，去掉 dryRun
    const steps = report.steps.filter((s) => s.item === i && s.args)
    const step = steps.find((s) => s.phase === 'apply' || s.phase === 'run') ?? steps.find((s) => s.phase === 'dryRun')
    if (!step?.args) continue
    const { dryRun: _dry, ...args } = step.args
    items.push(args)
  }
  return { op, items }
}
