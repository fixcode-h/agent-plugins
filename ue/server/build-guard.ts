import { jobLog, endJob } from './jobs.ts'
import { lockHeld, lockHolders, lockName, waitLockFree } from './livecoding-lock.ts'
import { blockerLines, editorBlockers, killBlockers } from './procs.ts'
import type { BuildBlocker, Job, UeProject } from './types.ts'
import { t } from './util.ts'

/** 两份进程列表按 PID 去重合并 */
function merge(a: BuildBlocker[], b: BuildBlocker[]) {
  return [...a, ...b.filter((x) => !a.some((y) => y.pid === x.pid))]
}

function stop(job: Job, blockers: BuildBlocker[]) {
  job.hint = { kind: 'live-coding', blockers }
  endJob(job, false)
  return false
}

/**
 * Build.bat 之前的检查，返回 false 表示这次不编（原因已写进作业）。
 * 进程只是线索，判据是 Live Coding 的锁（livecoding-lock.ts 写了为什么）：
 * 进程查不到但锁还在，照样不编；kill 模式下结束进程后要等锁真的消失才开始编，否则 Build.bat 一秒就失败。
 */
export async function guardBuild(p: UeProject, job: Job, kill: boolean): Promise<boolean> {
  if (process.platform !== 'win32') return true
  const { list, others, error } = await editorBlockers(p)
  if (error) jobLog(job, t('没能检查编辑器是否开着：{msg}', { msg: error }))
  if (!list.length) for (const o of others) jobLog(job, t('（别的引擎的编辑器，不挡编译：{o}）', { o }))

  if (!kill) {
    if (list.length) {
      for (const l of blockerLines(list)) jobLog(job, l)
      return stop(job, list)
    }
    if ((await lockHeld(p)) === true) {
      const holders = await lockHolders(p)
      jobLog(job, t('没找到开着的编辑器，但 Live Coding 的锁还在（{name}），引擎会拒绝编译。', { name: lockName(p) }))
      for (const l of blockerLines(holders).slice(holders.length ? 0 : 1)) jobLog(job, l)
      return stop(job, holders)
    }
    return true
  }

  // 强制关掉：编辑器进程加上加载了 Live Coding 模块的进程一起结束
  let targets = list
  if ((await lockHeld(p)) !== false) targets = merge(targets, await lockHolders(p))
  if (targets.length) {
    jobLog(
      job,
      t('强制结束：{list}', {
        list: targets.map((b) => `${b.name ?? 'UnrealEditor.exe'} PID ${b.pid}`).join('、'),
      }),
    )
    const { failed } = await killBlockers(targets)
    if (failed.length) {
      for (const f of failed) jobLog(job, t('PID {pid} 没能结束：{msg}', { pid: f.pid, msg: f.msg }))
      jobLog(job, t('编辑器是用管理员权限打开的话，面板没有权限结束它，请在编辑器里保存后手动关掉'))
      return stop(
        job,
        targets.filter((b) => failed.some((f) => f.pid === b.pid)),
      )
    }
  } else jobLog(job, t('没找到这个引擎开着的编辑器'))

  const held = await waitLockFree(p)
  if (held === true) {
    // 第一轮漏掉的（比如第一次查模块时还没加载完），再找一次给出来
    const rest = await lockHolders(p)
    jobLog(job, t('进程结束后 Live Coding 的锁还在（{name}），引擎仍会拒绝编译。', { name: lockName(p) }))
    jobLog(
      job,
      rest.length
        ? t('还拿着锁的进程：{list}', { list: rest.map((b) => `${b.name ?? '?'} PID ${b.pid}`).join('、') })
        : t(
            '找不到拿着锁的进程（可能是管理员权限打开的，面板看不到它加载的模块）：在任务管理器里结束 UnrealEditor 和 LiveCodingConsole，或者重启电脑',
          ),
    )
    return stop(job, rest)
  }
  jobLog(job, held === false ? t('Live Coding 的锁已释放，开始编译') : t('开始编译'))
  return true
}
