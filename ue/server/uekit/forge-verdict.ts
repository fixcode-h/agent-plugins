import type { McpResult } from '../../../sdk/server.ts'

/**
 * AssetForge 导入算不算进完成依据（ue_forge 标「验证」作用，和 ue_gametest 同一套）：
 * 只看正式导入（mode=import）跑完的作业——全部成功算通过、有失败算没通过；演练（plan）、导出、还在跑、取消了都没有结论
 */
export function forgeVerdict(r: Record<string, unknown>): McpResult['verified'] {
  const job = r.job as { mode?: string; status?: string; total?: number; failed?: number } | undefined
  if (!job || job.mode !== 'import') return undefined
  if (job.status === 'done') return { passed: true, name: `AssetForge 导入（${job.total ?? 0} 份）` }
  if (job.status === 'failed') return { passed: false, name: `AssetForge 导入（失败 ${job.failed ?? 0} 份）` }
  return undefined
}
