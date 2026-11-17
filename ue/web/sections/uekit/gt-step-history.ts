/** gt.history 给了 scenario 时的一条（最新在前）：failedStep 从 1 数，0 是运行配置的前置步骤 */
export interface GtHistoryRun {
  runId: string
  succeeded: boolean
  startedAtUtc?: string
  durationMs?: number
  total?: number
  failed?: number
  failedStep?: number
  message?: string
  revision?: number
}

export type Mark = 'p' | 'f' | 'n'

/** 这一步在一次运行里怎么样：通过 / 在这一步失败 / 没跑到（前面就失败了） */
export function stepMark(r: GtHistoryRun, i: number): Mark {
  if (r.succeeded || r.failedStep === undefined) return 'p'
  if (r.failedStep === i + 1) return 'f'
  return r.failedStep < i + 1 ? 'n' : 'p'
}
