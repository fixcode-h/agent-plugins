import { isBatchArgs } from '../long-ops.ts'
import { liveCards } from '../instances.ts'
import type { UeProject, Target } from '../types.ts'
import { canOffline, runOffline } from './offline/index.ts'
import { OfflineReadError } from './read.ts'

/**
 * 编辑器没开时先从文件读（用户 2026-11-25：没开编辑器不再启动后台编辑器，统一用自写的读取器读资源结构）。
 * 只管读操作：编辑器开着时照旧发给编辑器（有没保存的改动、C++ 默认值、显示名）；指定了后台编辑器的照旧发给它；
 * 读取器读不了（烘焙过的包、更新的引擎版本……）时返回原因，ops.ts 再按原来的路走 UE，失败时把这个原因一起说出来。
 */
export async function offlineFirst(
  project: UeProject,
  target: Target | undefined,
  op: string,
  args: Record<string, unknown>,
  readOnly: boolean,
): Promise<{ res?: Record<string, unknown>; why?: string }> {
  if (!readOnly || isBatchArgs(args) || !canOffline(op, args)) return {}
  if (target?.instance === 'background' || typeof target?.instance === 'number') return {}
  if ((await liveCards(project.root)).some((x) => x.kind === 'editor')) return {}
  try {
    return { res: await runOffline(op, { project, args }) }
  } catch (e) {
    if (e instanceof OfflineReadError) return { why: e.message }
    throw e
  }
}
