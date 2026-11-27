/**
 * 对话里 ue_gametest 跑脚本那一行的卡片（插件网页 toolCards，面板 2026-11-26 加的）要的纯数据：
 * 跑的是哪个脚本、这次的运行号、现在怎样。不依赖 React，单测直接跑（state.test.ts）
 */
import type { GtJob } from '../sections/uekit/gt-run/types.ts'
import { outcomeOf, PHASE_TITLE, type PhaseKey, type PhaseRecord } from '../sections/uekit/gt-rows/phases.ts'
import { t } from '../host.ts'

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

export type RunPhase = 'starting' | 'running' | 'passed' | 'failed' | 'blocked' | 'error' | 'unknown'

/** 跑完的这次运行的报告摘要：作业已经换成别的运行时，按报告里失败的步数定通过没有 */
export interface RunTally {
  total: number
  failed: number
  /** 执行前没通过：前置不满足（GameTest 2.8.0） */
  blocked?: boolean
}

export function tallyOf(steps: PhaseRecord[]): RunTally {
  const real = steps.filter((s) => !s.block)
  return {
    total: real.length,
    failed: real.filter((s) => s.status === 'failed' && !s.warn).length,
    ...(outcomeOf(steps) === 'blocked' && { blocked: true }),
  }
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
  if (j) return j.outcome === 'blocked' ? 'blocked' : j.failed > 0 || j.status === 'failed' ? 'failed' : 'passed'
  if (o.tally) return o.tally.blocked ? 'blocked' : o.tally.failed > 0 ? 'failed' : 'passed'
  return 'unknown'
}

/**
 * 跑着时列的一步：脚本里写了 title（节点名称）或 note（说明）就用它当这一行的主文字，结果消息退到后面（用户 2026-11-27：
 * 只显示「api 已调 项目.X → null」看不出每步在做什么，GameTest 页运行记录早就先显示 note，对话卡片要一致）。
 * 没写 note 的照旧：动作名 + 结果消息
 */
export function liveStepLine(s: {
  action?: string
  message?: string
  title?: string
  note?: string
  target?: string
}): {
  title: string
  detail: string
  /** title 是动作名（没写 note）：用等宽字 */
  code: boolean
} {
  // 名称（title，GameTest 2.6.0）是专门给这一行的短句；旧脚本只有说明（note）
  const note = s.title?.trim() || s.note?.trim()
  const msg = (s.message || s.target || '').trim()
  if (note) return { title: note, detail: msg, code: false }
  return { title: s.action ?? '?', detail: msg, code: true }
}

/**
 * 卡片头上的进度：GameTest 2.8.0 起按段数「执行 第 3/5 步」（只数这段顶层的节点），不再拿已完成记录数比计划步数
 * （子脚本、循环里的记录会让它超过，出现「第 9/8 步」）。旧 GameTest 没有 phases 时返回 undefined，照旧显示
 */
export function phaseProgress(job?: Pick<GtJob, 'phase' | 'phases'>): string | undefined {
  const p = job?.phase as PhaseKey | undefined
  const c = p && job?.phases?.[p]
  if (!p || !c) return undefined
  const n = Math.min(c.done + 1, c.total)
  return t('{phase} 第 {n}/{m} 步', { phase: PHASE_TITLE[p](), n, m: c.total })
}
