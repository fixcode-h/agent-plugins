/**
 * 对话里 ue_gametest 跑脚本那一行的卡片（插件网页 toolCards，面板 2026-11-26 加的）要的纯数据：
 * 跑的是哪个脚本、这次的运行号、现在怎样。不依赖 React，单测直接跑（state.test.ts）
 */
import type { GtJob } from '../sections/uekit/gt-run/types.ts'

/** 这次调用跑的是什么：脚本路径、按标签批量、临时步骤 */
export function runTarget(args: Record<string, unknown>): { scenario?: string; label: string } {
  const s = typeof args.scenario === 'string' ? args.scenario.trim() : ''
  // 一行里放不下整条路径：显示文件名，完整路径放悬停提示
  if (s)
    return {
      scenario: s,
      label:
        s
          .replace(/\.json$/i, '')
          .split(/[\\/]/)
          .pop() ?? s,
    }
  if (typeof args.tag === 'string' && args.tag.trim()) return { label: `tag=${args.tag.trim()}` }
  const list = Array.isArray(args.scenarios) ? args.scenarios.filter((x): x is string => typeof x === 'string') : []
  if (list.length) return { label: list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0] }
  if (Array.isArray(args.steps)) return { label: `steps×${args.steps.length}` }
  return { label: '' }
}

/** 工具返回的原文里取 gt.run 的结果：{runId, steps, finished?} 或 {error}；没有 JSON 时当没拿到 */
export function runResult(output: string): { runId?: string; planned?: number; error?: string } {
  const i = output.indexOf('{')
  if (i < 0) return {}
  try {
    const o = JSON.parse(output.slice(i, output.lastIndexOf('}') + 1)) as Record<string, unknown>
    return {
      ...(typeof o.runId === 'string' && { runId: o.runId }),
      ...(typeof o.steps === 'number' && { planned: o.steps }),
      ...(typeof o.error === 'string' && { error: o.error }),
    }
  } catch {
    return {}
  }
}

export type RunPhase = 'starting' | 'running' | 'passed' | 'failed' | 'error' | 'unknown'

/** 跑完的这次运行的报告摘要：作业已经换成别的运行时，按报告里失败的步数定通过没有 */
export interface RunTally {
  total: number
  failed: number
}

export function tallyOf(steps: { status: string; block?: boolean; warn?: boolean }[]): RunTally {
  const real = steps.filter((s) => !s.block)
  return { total: real.length, failed: real.filter((s) => s.status === 'failed' && !s.warn).length }
}

/** 卡片上的状态：调用还没回来是 starting；推送 / 查到的作业是这次的就按它；作业换了就按这次的报告；都没有是 unknown */
export function runPhase(o: {
  calling: boolean
  failed: boolean
  error?: string
  runId?: string
  job?: GtJob
  tally?: RunTally
}): RunPhase {
  if (o.calling) return 'starting'
  if (o.failed || o.error) return 'error'
  if (!o.runId) return 'error'
  const j = o.job?.runId === o.runId ? o.job : undefined
  if (j && (j.busy || j.status === 'running')) return 'running'
  if (j) return j.failed > 0 || j.status === 'failed' ? 'failed' : 'passed'
  if (o.tally) return o.tally.failed > 0 ? 'failed' : 'passed'
  return 'unknown'
}
