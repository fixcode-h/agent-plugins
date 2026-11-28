/**
 * ue_gametest action=job 在工具里等（面板 ADR 0067 第 5 节：一分钟内能等到的在工具里等到再返回，不让 Agent 轮询）。
 * 以前 job 调一次马上返回，Agent 一次碰杯测试里调了 333 次。现在等到下面任一情况才返回：
 * 跑完（busy=false）、多了失败的步骤、批量里又跑完一个场景、或等满 waitMs。
 * gt.job 的推送通道只在 UE 页开着时连（stream.ts），工具里不能指望它，所以在这里隔一秒读一次 gt.job。
 */
export type JobRec = Record<string, unknown>

interface Batch {
  current?: number
  passed?: number
  failed?: number
}

/** 默认等多久：留出余量，整个工具调用不超过一分钟 */
export const JOB_WAIT_DEFAULT_MS = 45000
export const JOB_WAIT_MAX_MS = 55000

/** 进度的「指纹」：失败数、批量里完成到第几个；变了就该让 Agent 看一眼 */
function mark(j: JobRec) {
  const b = (j.batch ?? {}) as Batch
  return `${Number(j.failed ?? 0)}|${b.current ?? ''}|${Number(b.passed ?? 0) + Number(b.failed ?? 0)}`
}

export interface WaitOpts {
  waitMs: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** 返回最后一次读到的作业；还在跑时带 stillRunning + hint，让 Agent 知道要再调一次 */
export async function waitJob(read: () => Promise<JobRec>, o: WaitOpts): Promise<JobRec> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = o.now ?? Date.now
  const interval = o.intervalMs ?? 1000
  const waitMs = Math.max(0, Math.min(o.waitMs, JOB_WAIT_MAX_MS))
  const start = now()
  let job = await read()
  const first = mark(job)
  // 跑着的时候编辑器卡住（加载、断点）：gt.job 读不到不算作业没了，接着等它恢复；
  // GameTest 2.9 起卡住的时间不算步骤超时，恢复后作业照常往下走（用户 2026-11-28：卡住被当成断开）
  let stuck = ''
  while (job.busy === true && mark(job) === first && now() - start < waitMs) {
    await sleep(interval)
    try {
      job = await read()
      stuck = ''
    } catch (e) {
      stuck = (e as Error).message
    }
  }
  if (job.busy !== true || waitMs === 0) return job
  const waited = Math.round((now() - start) / 1000)
  if (stuck)
    return {
      ...job,
      stillRunning: true,
      stuck,
      hint: `编辑器暂时没回应（见 stuck），作业还在、不是断开：恢复后接着跑，再调一次 job 接着等，不要重跑或重启`,
    }
  return {
    ...job,
    stillRunning: true,
    hint:
      mark(job) === first
        ? `等了 ${waited} 秒还在跑：再调一次 job 接着等，不用 sleep`
        : '进度有变化（有步骤失败或批量里又跑完一个）：先看这次的结果，再调 job 接着等',
  }
}
