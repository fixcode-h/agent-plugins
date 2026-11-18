import type { GtFlowEvent } from '../gt-flow/run-state.ts'

/**
 * 右栏「运行记录」（效果图 6）：把 gt.flow 推送按到达顺序记成一条条记录。
 * 一个节点进去时记一条，出来时补上结果和耗时；循环换轮、守护触发、暂停各记一条。
 * 只记 key（步骤 id 或路径），标题由界面按当前脚本查；纯函数，单测在 run-log.test.ts
 */
export type LogKind = 'step' | 'iter' | 'guard' | 'pause'

export interface LogEntry {
  /** 记录自己的序号（React key） */
  n: number
  kind: LogKind
  /** 步骤 key；守护是守护 id */
  key: string
  /** 路径里有几层块：缩进用 */
  depth: number
  status?: 'running' | 'passed' | 'failed' | 'skipped' | 'already'
  iter?: number
  ms?: number
  /** 开跑后第几毫秒 */
  at: number
}

export interface RunLog {
  runId?: string
  /** 第一条推送到达的时间 */
  t0?: number
  entries: LogEntry[]
  /** 守护处理中：它里面的步骤缩进一层 */
  inGuard?: boolean
}

/** 记录太多时只留最近的：长循环跑上千轮，右栏不用全留 */
export const LOG_MAX = 400

export const emptyLog = (): RunLog => ({ entries: [] })

/** 路径里每进一层块多两段（steps.3.do.0 → 1 层），没有路径按 0 */
const depthOf = (path?: string) => (path ? Math.max(0, Math.floor((path.split('.').length - 2) / 2)) : 0)

export function applyLog(log: RunLog, e: GtFlowEvent, now: number): RunLog {
  const base: RunLog = e.runId && e.runId !== log.runId ? { runId: e.runId, entries: [] } : log
  const t0 = base.t0 ?? now
  const key = e.id || e.path || ''
  const at = now - t0
  const n = (base.entries[base.entries.length - 1]?.n ?? -1) + 1
  const depth = depthOf(e.path) + (base.inGuard ? 1 : 0)
  const push = (x: Omit<LogEntry, 'n' | 'at'>, inGuard = base.inGuard): RunLog => ({
    ...base,
    t0,
    inGuard,
    entries: [...base.entries, { ...x, n, at }].slice(-LOG_MAX),
  })
  switch (e.phase) {
    case 'enter':
      return push({ kind: 'step', key, depth, status: 'running' })
    case 'leave': {
      // 补到最近一条还在跑的同一步上（循环里同一步进出多次，补最后那次）
      const entries = [...base.entries]
      for (let i = entries.length - 1; i >= 0; i--) {
        const x = entries[i]
        if (x.kind === 'step' && x.key === key && x.status === 'running') {
          entries[i] = { ...x, status: (e.status as LogEntry['status']) ?? 'passed', ms: e.ms }
          return { ...base, t0, entries }
        }
      }
      return push({ kind: 'step', key, depth, status: (e.status as LogEntry['status']) ?? 'passed', ms: e.ms })
    }
    case 'iter':
      return push({ kind: 'iter', key, depth, iter: e.iter })
    case 'guard':
      return push(
        { kind: 'guard', key: e.guard ?? key, depth: base.inGuard ? depth - 1 : depth, status: 'running' },
        true,
      )
    case 'guardEnd': {
      const entries = [...base.entries]
      for (let i = entries.length - 1; i >= 0; i--)
        if (entries[i].kind === 'guard' && entries[i].status === 'running') {
          entries[i] = { ...entries[i], status: e.status === 'failed' ? 'failed' : 'passed', ms: e.ms }
          break
        }
      return { ...base, t0, entries, inGuard: false }
    }
    case 'pause':
      return push({ kind: 'pause', key, depth })
    default:
      return base
  }
}

/** 开跑后的时间：0:33 */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
