/**
 * 版本差异读取的分步进度（服务端 asset-diff/progress.ts 推，网页 asset-diff/Progress.tsx 画）
 */
export type StepId = 'fetch-a' | 'fetch-b' | 'read-a' | 'read-b' | 'compare'

export interface DiffStep {
  id: StepId
  label: string
  state: 'wait' | 'run' | 'ok' | 'skip' | 'fail'
  detail?: string
  /** 这一步开始的时间（毫秒），网页据此显示「已等 N 秒」 */
  since?: number
  ms?: number
}

export interface DiffProgress {
  req: string
  startedAt: number
  steps: DiffStep[]
  /** 这一次由哪个 UE 进程读 */
  reader?: { kind: string; pid: number }
}

/** 读不了时的出路：unlinked 编辑器开着没连上（给诊断）、no-ue 没有能读的进程（给启动后台编辑器）、old-bridge UELink 旧 */
export interface DiffFailed {
  kind: 'unlinked' | 'no-ue' | 'old-bridge' | 'other'
  message: string
}
