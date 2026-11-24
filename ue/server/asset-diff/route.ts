import type { DiffFailed } from '../../shared/asset-diff/progress.ts'
import type { AssetDiff } from '../../shared/asset-diff/types.ts'
import type { UeProject } from '../types.ts'
import { DiffReadError } from './reader.ts'
import { assetDiffFor, parseSource } from './snapshot.ts'

/**
 * POST asset-diff：读不了的几种情况（编辑器开着没连上、没有 UE 进程、UELink 旧）不当成请求出错，
 * 回 failed 让网页给对应的出路（连接诊断、启动后台编辑器、去升级）；其余错误照常抛，网页显示原文
 */
export async function assetDiffRoute(
  project: UeProject,
  b: Record<string, unknown>,
): Promise<AssetDiff | { failed: DiffFailed }> {
  try {
    return await assetDiffFor(project, String(b.path ?? ''), parseSource(b.from), parseSource(b.to), {
      req: b.req ? String(b.req) : undefined,
      conn: b.conn ? String(b.conn) : undefined,
      startBackground: b.startBackground === true,
    })
  } catch (e) {
    if (e instanceof DiffReadError) return { failed: { kind: e.kind, message: e.message } }
    throw e
  }
}
