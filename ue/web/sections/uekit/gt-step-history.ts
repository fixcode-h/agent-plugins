import { comparePath, isPrefix, parsePath } from '../../../shared/gt-script/index.ts'

/** gt.history 给了 scenario 时的一条（最新在前）：failedStep 从 1 数，0 是运行配置的前置步骤 */
export interface GtHistoryRun {
  runId: string
  succeeded: boolean
  startedAtUtc?: string
  durationMs?: number
  total?: number
  failed?: number
  failedStep?: number
  /** GameTest 1.11.2 起：失败步骤的路径（steps.1.do.3）。块里的步骤 failedStep 只是所在槽里的序号 */
  failedPath?: string
  message?: string
  revision?: number
}

/** p 通过、f 在这一步失败（块：里面有一步失败）、n 没跑到、u 对不上（旧记录只有序号，场景里有块时分不出是哪一步） */
export type Mark = 'p' | 'f' | 'n' | 'u'

/** 行在场景里的位置：完整路径和所在槽、槽里第几步 */
export interface MarkPlace {
  key: string
  slot: string
  i: number
}

/**
 * 这一步在一次运行里怎么样：通过 / 在这一步失败 / 没跑到（前面就失败了）。
 * 有 failedPath 按路径比先后；只有 failedStep 时，场景里没有块才按顶层序号比，有块时只能说对不上
 */
export function stepMark(r: GtHistoryRun, at: MarkPlace, hasBlocks = false): Mark {
  if (r.succeeded || r.failedStep === undefined) return 'p'
  // 前置步骤失败：场景里一步都没跑
  if (r.failedStep === 0 && !r.failedPath) return 'n'
  if (r.failedPath) {
    const failed = parsePath(r.failedPath)
    const me = parsePath(at.key)
    if (isPrefix(me, failed)) return 'f'
    return comparePath(failed, me) < 0 ? 'n' : 'p'
  }
  if (hasBlocks) return 'u'
  const i = at.i
  if (r.failedStep === i + 1) return 'f'
  return r.failedStep < i + 1 ? 'n' : 'p'
}
