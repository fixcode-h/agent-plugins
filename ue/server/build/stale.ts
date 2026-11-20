import { endJob, jobLog } from '../jobs.ts'
import type { Job, UeProject } from '../types.ts'
import { t } from '../util.ts'
import { buildProcs, killProcs, otherProcs, procLines } from './procs.ts'

/** Build.bat / UBT 排在别的编译后面等互斥量时的输出 */
export const WAIT_MUTEX =
  /already running, waiting for existing script|Waiting for (?:other|existing) .*(?:UBT|UnrealBuildTool|instance)/i

/**
 * 编译前看这个引擎有没有别的编译在跑（server/build/procs.ts 写了为什么），返回 false 表示这次不编（原因写进作业）。
 * 有的话不悄悄排队：作业带上 stale-build 提示，网页让用户选「接着看它」或「结束旧的再编」。
 * killStale 是用户确认过的「结束旧的再编」：先结束，再开始编。
 */
export async function guardStale(p: UeProject, job: Job, killStale: boolean): Promise<boolean> {
  const { procs, error } = await buildProcs(p)
  if (error) {
    jobLog(job, t('没能检查有没有别的编译在跑：{msg}', { msg: error }))
    return true
  }
  const others = otherProcs(procs, job.id)
  if (!others.length) return true
  if (!killStale) {
    jobLog(job, t('这个引擎还有编译在跑，新的编译会排在它后面一直等，这次没有开始：'))
    for (const l of procLines(others)) jobLog(job, l)
    job.hint = { kind: 'stale-build', procs: others }
    endJob(job, false)
    return false
  }
  jobLog(job, t('结束之前的编译：{list}', { list: procLines(others).join('、') }))
  const { failed } = await killProcs(others)
  if (failed.length) {
    for (const f of failed) jobLog(job, t('PID {pid} 没能结束：{msg}', { pid: f.pid, msg: f.msg }))
    jobLog(
      job,
      t('编译是用管理员权限起的话，面板没有权限结束它：在任务管理器里结束 dotnet / UnrealBuildTool / cmd，再编译'),
    )
    job.hint = { kind: 'stale-build', procs: others.filter((x) => failed.some((f) => f.pid === x.pid)) }
    endJob(job, false)
    return false
  }
  jobLog(job, t('之前的编译已结束，开始编译'))
  return true
}

/**
 * 编译跑起来后才发现在排队（预检没查到、或预检后别处又起了一个）：作业不停，带上 waiting 的提示，
 * 网页给「结束旧的，这次接着编」和「取消这次，看旧的」。每个作业只查一次。
 */
export function watchWaitMutex(p: UeProject, job: Job) {
  let seen = false
  return (text: string) => {
    if (seen || !WAIT_MUTEX.test(text)) return
    seen = true
    void buildProcs(p).then(({ procs, error }) => {
      if (job.status !== 'running') return
      const others = otherProcs(procs, job.id)
      if (error || !others.length) {
        jobLog(
          job,
          t(
            '在等别的编译结束，但没找到它的进程{why}：可能是管理员权限起的，在任务管理器里看看 dotnet / UnrealBuildTool',
            {
              why: error ? `（${error}）` : '',
            },
          ),
        )
        return
      }
      jobLog(job, t('在等这些编译结束：{list}', { list: procLines(others).join('、') }))
      job.hint = { kind: 'stale-build', procs: others, waiting: true }
    })
  }
}
