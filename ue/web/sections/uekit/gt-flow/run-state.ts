/**
 * 流程图运行高亮的状态（定稿 9.2、效果图 6）：只由推送更新，不轮询。
 * - gt.flow（协议第 10 节「推送」）：节点进出、循环换轮、守护触发 / 结束、暂停 / 继续；
 * - gt.job：多带的 at（当前步骤）和 guards（{守护 id: 次数}，以它为准，角标数字照它画）。
 * 步骤按 id 记，没有 id 的按路径（和布局里的 stepKey 一样）。纯函数，单测在 run-state.test.ts
 */

export type StepRunStatus = 'running' | 'passed' | 'failed' | 'skipped' | 'already'

export interface StepRun {
  status: StepRunStatus
  /** 循环第几轮（从 1 数，界面直接显示） */
  iter?: number
  ms?: number
  /** 这次运行里进过这一步几次（循环里的步骤每轮 +1），节点右上角的次数角标照它画 */
  runs?: number
}

export interface FlowRunState {
  runId?: string
  /** 正在跑（含暂停中） */
  active: boolean
  paused: boolean
  /** 当前所在的步骤 */
  at?: string
  steps: Record<string, StepRun>
  /** 每条守护这次运行里触发了几次 */
  guards: Record<string, number>
  /** 正在处理的守护 */
  guardActive?: string
  /** 暂停时此刻的变量 */
  vars?: Record<string, unknown>
}

export interface GtFlowEvent {
  runId?: string
  phase: 'enter' | 'leave' | 'iter' | 'guard' | 'guardEnd' | 'pause' | 'resume' | string
  id?: string
  path?: string
  status?: string
  iter?: number
  guard?: string
  ms?: number
  vars?: Record<string, unknown>
}

export const emptyRun = (): FlowRunState => ({ active: false, paused: false, steps: {}, guards: {} })

const keyOf = (e: { id?: string; path?: string }) => e.id || e.path || ''

const DONE = new Set<string>(['passed', 'failed', 'skipped', 'already'])

export function applyFlowEvent(s: FlowRunState, e: GtFlowEvent): FlowRunState {
  // 新的一次运行：上一次的高亮、计数都清掉
  const base = e.runId && e.runId !== s.runId ? { ...emptyRun(), runId: e.runId } : s
  const key = keyOf(e)
  const put = (patch: Partial<StepRun>) =>
    key ? { ...base.steps, [key]: { ...(base.steps[key] ?? { status: 'running' as const }), ...patch } } : base.steps
  switch (e.phase) {
    case 'enter':
      // 再次进入（下一轮循环）从头记：上一轮的耗时、轮次不留，只累计进过几次
      return {
        ...base,
        active: true,
        at: key || base.at,
        steps: key
          ? { ...base.steps, [key]: { status: 'running', runs: (base.steps[key]?.runs ?? 0) + 1 } }
          : base.steps,
      }
    case 'leave': {
      const status = (DONE.has(e.status ?? '') ? e.status : 'passed') as StepRunStatus
      return { ...base, active: true, steps: put({ status, ms: e.ms }) }
    }
    case 'iter':
      return { ...base, active: true, steps: put({ status: 'running', iter: e.iter }) }
    case 'guard': {
      const g = e.guard ?? key
      return g
        ? { ...base, active: true, guardActive: g, guards: { ...base.guards, [g]: (base.guards[g] ?? 0) + 1 } }
        : base
    }
    case 'guardEnd':
      return { ...base, guardActive: undefined }
    case 'pause':
      return { ...base, active: true, paused: true, at: key || base.at, vars: e.vars }
    case 'resume':
      return { ...base, paused: false, vars: undefined }
    default:
      return base
  }
}

/** gt.job 里流程图用到的几项（gt-run/types.ts 的 GtJob 多带的 at、guards，协议第 10 节） */
export interface GtJobFlowPart {
  runId?: string
  busy?: boolean
  at?: string
  guards?: Record<string, number>
}

/** gt.job 推送：守护次数以它为准（gt.flow 漏了一条也能对上）；跑完了收起运行态，但留着每步的结果和次数 */
export function applyJob(s: FlowRunState, j: GtJobFlowPart): FlowRunState {
  const base = j.runId && j.runId !== s.runId ? { ...emptyRun(), runId: j.runId } : s
  const busy = !!j.busy
  return {
    ...base,
    active: busy,
    paused: busy && base.paused,
    at: busy ? (j.at ?? base.at) : undefined,
    guards: j.guards ? { ...j.guards } : base.guards,
    guardActive: busy ? base.guardActive : undefined,
  }
}

/** 守护栏标题上的总次数 */
export const guardTotal = (s: FlowRunState) => Object.values(s.guards).reduce((n, v) => n + (v > 0 ? v : 0), 0)
