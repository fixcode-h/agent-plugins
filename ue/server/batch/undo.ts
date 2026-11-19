import { readFile } from 'node:fs/promises'
import { t } from '../util.ts'

/**
 * 批量作业（UELink 2.14，协议文档「批量」）在面板这边的撤回：整批一条操作记录，撤回时把每个资源的撤回信息
 * 一次交给 UELink（asset.undo 的 items、set 的 items），也是一个批量作业。撤回信息从作业的 report 文件里取
 */

/** 参数里的每个资源路径（paths 或 items[].path） */
export function itemPaths(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.paths)) return args.paths.map(String)
  if (Array.isArray(args.items)) return args.items.map((x) => String((x as { path?: unknown })?.path ?? ''))
  return []
}

export interface ReportStep {
  op: string
  state: 'ok' | 'failed' | 'skipped'
  item?: number
  phase?: string
  error?: string
  args?: Record<string, unknown>
  result?: Record<string, unknown>
}

/** 读作业的 report 文件（UE 写在 Saved/UELink/jobs/<作业号>.json）；读不到返回空 */
export async function readReport(file: unknown): Promise<{ steps: ReportStep[] } | undefined> {
  if (typeof file !== 'string' || !file) return undefined
  try {
    return JSON.parse(await readFile(file, 'utf8')) as { steps: ReportStep[] }
  } catch {
    return undefined
  }
}

/** 真改成功、之后没被回滚的步骤 */
function applied(steps: ReportStep[]) {
  const undone = new Set(steps.filter((s) => s.phase === 'undo' && s.state === 'ok').map((s) => s.item))
  return steps.filter((s) => s.phase === 'apply' && s.state === 'ok' && !undone.has(s.item))
}

/** 操作记录的撤回信息：有 tx 的走 asset.undo，set 用 prev 设回去；都没有的说明撤不回 */
export async function batchUndo(op: string, res: Record<string, unknown>) {
  const report = await readReport(res.report)
  if (!report) return { noUndo: t('读不到批量作业的结果文件，撤不回：没保存前用「放弃改动」') }
  const done = applied(report.steps ?? [])
  const tx = done.filter((s) => typeof s.result?.tx === 'string' && s.result.tx)
  if (tx.length)
    return {
      undo: {
        op: 'asset.undo',
        // 倒序撤：和改的顺序相反
        args: { items: tx.reverse().map((s) => ({ path: s.args?.path, tx: s.result?.tx })), onError: 'keep' },
      },
    }
  if (op === 'set' && done.some((s) => s.result && 'prev' in s.result))
    return {
      undo: {
        op: 'set',
        args: {
          items: done.reverse().map((s) => ({ path: s.args?.path, prop: s.args?.prop, value: s.result?.prev })),
          onError: 'keep',
        },
      },
    }
  if (!done.length) return { noUndo: t('这一批没有改动留下') }
  return { noUndo: t('这一批改动不能自动撤回：没保存前用「放弃改动」') }
}
