import type { McpResult } from '../../../sdk/server.ts'

/**
 * GameTest 的结果算不算进完成依据（ue_gametest 标「验证」作用，和 ue_compile 同一套）：
 * - 跑完的场景文件（报告带 scenario）：通过算通过，失败算没通过；
 * - 跑完的批量：全部通过才算通过；
 * - 还在跑、临时步骤（Agent 探路用的 steps）、单步：没有结论，不交——探路失败不该挡住对话结束。
 * 编辑器没开时从磁盘读的旧报告（offline）不交。
 * 报告超长被写成文件时（truncated）顶层还留着 succeeded / name，照样能判断。
 */
export function gtVerdict(r: Record<string, unknown>): McpResult['verified'] {
  const batch = r.batch as { active?: boolean; label?: string; total?: number; passed?: number } | undefined
  if (batch && batch.active === false && (batch.total ?? 0) > 0)
    return { passed: batch.passed === batch.total, name: `GameTest ${batch.label ?? ''}`.trim() }
  // 编辑器没开时从磁盘读到的是以前的报告（offline），不能当成这次的结论
  if (r.offline === true || r.busy === true || typeof r.succeeded !== 'boolean') return undefined
  const scenario = typeof r.scenario === 'string' ? r.scenario : ''
  if (!scenario) return undefined
  return { passed: r.succeeded, name: `GameTest ${r.name || scenario}` }
}

/**
 * 执行前没通过（GameTest 2.8.0 的 outcome: blocked）：在结果里补一句下一步。缺前置时 Agent 以前会去改测试脚本、
 * 甚至在运行时改配置绕过入口（碰杯那次），这里写明该回去补前置
 */
export function withBlockedHint(r: Record<string, unknown>): Record<string, unknown> {
  if (r.outcome !== 'blocked') return r
  const step = typeof r.blockedStep === 'string' ? r.blockedStep : '执行前的一步'
  const why = typeof r.blockedReason === 'string' && r.blockedReason ? `（${r.blockedReason}）` : ''
  return {
    ...r,
    next: `前置不满足：${step}没通过${why}，测试本身没开始。先补前置（表格配置、资源、剧情、环境）再重跑；不要改测试脚本的执行段，也不要在运行时改配置或跳过入口`,
  }
}
