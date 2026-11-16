import type { McpResult } from '../../../sdk/server.ts'

/**
 * GameTest 的结果算不算进完成依据（ue_gametest 标「验证」作用，和 ue_compile 同一套）：
 * - 跑完的场景文件（报告带 scenario）：通过算通过，失败算没通过；
 * - 跑完的批量：全部通过才算通过；
 * - 还在跑、临时步骤（Agent 探路用的 steps）、单步：没有结论，不交——探路失败不该挡住对话结束。
 * 报告超长被写成文件时（truncated）顶层还留着 succeeded / name，照样能判断。
 */
export function gtVerdict(r: Record<string, unknown>): McpResult['verified'] {
  const batch = r.batch as { active?: boolean; label?: string; total?: number; passed?: number } | undefined
  if (batch && batch.active === false && (batch.total ?? 0) > 0)
    return { passed: batch.passed === batch.total, name: `GameTest ${batch.label ?? ''}`.trim() }
  if (r.busy === true || typeof r.succeeded !== 'boolean') return undefined
  const scenario = typeof r.scenario === 'string' ? r.scenario : ''
  if (!scenario) return undefined
  return { passed: r.succeeded, name: `GameTest ${r.name || scenario}` }
}
