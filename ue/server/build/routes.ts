import { jobLog, runningJob } from '../jobs.ts'
import type { BuildProc, UeProject } from '../types.ts'
import { t } from '../util.ts'
import { buildProcs, killProcs, procLines } from './procs.ts'
import { watchBuild } from './watch.ts'

/**
 * 网页「编译进程」的两个动作：结束、接着看。pids 是网页上看到的那几个（提示里列的）；
 * 进程是重新查的，不信网页给的旧列表：期间旧编译可能自己结束了，PID 也可能被别的进程复用。
 * 不给 pids 时取所有残留的（不是面板正在跟踪的）。选中的进程连同查到的子进程一起算。
 */
async function pick(p: UeProject, pids: unknown) {
  const { procs, error } = await buildProcs(p)
  if (error) throw new Error(t('没能查编译进程：{msg}', { msg: error }))
  const want = Array.isArray(pids) ? new Set(pids.map(Number)) : undefined
  const sel = new Set(procs.filter((x) => (want ? want.has(x.pid) : !x.job)).map((x) => x.pid))
  for (let grew = true; grew; ) {
    grew = false
    for (const x of procs)
      if (!sel.has(x.pid) && sel.has(x.ppid)) {
        sel.add(x.pid)
        grew = true
      }
  }
  return procs.filter((x) => sel.has(x.pid))
}

/** 用户在网页上确认过的「结束旧的编译」；有作业正排在它后面等时，结束后把那个作业的提示撤掉，它会自己接着编 */
export async function killBuildProcs(p: UeProject, pids: unknown) {
  const list = await pick(p, pids)
  if (!list.length) return { killed: [] as number[], failed: [], note: t('这些编译已经结束了') }
  const { failed } = await killProcs(list)
  const killed = list.map((x) => x.pid).filter((pid) => !failed.some((f) => f.pid === pid))
  const waiting = runningJob(p.id, 'build')
  if (waiting?.hint?.kind === 'stale-build' && waiting.hint.waiting) {
    jobLog(waiting, t('已结束之前的编译：{list}', { list: procLines(list).join('、') }))
    if (!failed.length) waiting.hint = undefined
  }
  return { killed, failed }
}

export async function watchBuildProcs(p: UeProject, pids: unknown) {
  const list: BuildProc[] = await pick(p, pids)
  if (!list.length) return { error: t('这些编译已经结束了，可以直接编译') }
  return { job: (await watchBuild(p, list)).id }
}
