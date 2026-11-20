import { open, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { endJob, getJob, jobLog, newJob, offCancel, onCancel, runningJob } from '../jobs.ts'
import type { BuildProc, Job, UeProject } from '../types.ts'
import { alive, t } from '../util.ts'
import { killProcs, procLines } from './procs.ts'

/**
 * 「接着看」没人跟踪的编译（面板升级插件、重启前起的，或在 VS、命令行里起的）：
 * 它的输出管道已经接不回来了，改读 UnrealBuildTool 自己写的 Log.txt（从现在的末尾往后读），
 * 进程都退出后作业结束，按日志里 UBT 的「Result: Succeeded / Failed」判成败。
 */

/** UBT 的日志：UE5 写在用户目录（Windows %LOCALAPPDATA%\UnrealBuildTool），老版本写在引擎的 Programs 下；取最近改过的 */
async function ubtLog(p: UeProject) {
  const home = os.homedir()
  const list = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'UnrealBuildTool', 'Log.txt') : '',
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Epic', 'UnrealBuildTool', 'Log.txt')
      : path.join(home, '.config', 'Epic', 'UnrealBuildTool', 'Log.txt'),
    p.engine.dir ? path.join(p.engine.dir, 'Engine', 'Programs', 'UnrealBuildTool', 'Log.txt') : '',
  ].filter(Boolean)
  let best = { file: '', at: 0 }
  for (const f of list) {
    const s = await stat(f).catch(() => undefined)
    if (s && s.mtimeMs > best.at) best = { file: f, at: s.mtimeMs }
  }
  return best.file
}

const RESULT_OK = /Result:\s*Succeeded|Target is up to date/i
const RESULT_FAIL = /Result:\s*Failed|BUILD FAILED|error [A-Z]+\d+:/i

/** 已经有作业在跟踪这些进程（面板别的项目起的）就直接看那个作业，不另开 */
function trackedJob(procs: BuildProc[]) {
  const id = procs.find((x) => x.job)?.job
  return id ? getJob(id) : undefined
}

export async function watchBuild(p: UeProject, procs: BuildProc[]): Promise<Job> {
  const tracked = trackedJob(procs)
  if (tracked && procs.every((x) => x.job === tracked.id)) return tracked
  // 刚取消的作业（「取消这次，看旧的」）进程还在退出，不算占着
  const busy = runningJob(p.id, 'build')
  if (busy && !busy.canceled) return busy
  const job = newJob(p.id, 'build', t('接着看之前的编译'))
  jobLog(
    job,
    t(
      '这些编译进程不是这次面板起的（面板升级插件、重启前起的，或者在 VS、命令行里起的），输出接不回来，改读 UBT 的日志：',
    ),
  )
  for (const l of procLines(procs)) jobLog(job, l)
  const pids = procs.map((x) => x.pid)
  const file = await ubtLog(p)
  if (file) jobLog(job, t('日志：{file}', { file }))
  else jobLog(job, t('没找到 UBT 的日志文件，只能等进程退出'))

  let offset = file ? ((await stat(file).catch(() => undefined))?.size ?? 0) : 0
  let rest = ''
  let ok = false
  let fail = false
  const read = async () => {
    if (!file) return
    const s = await stat(file).catch(() => undefined)
    if (!s) return
    // UBT 每次启动会重写日志：变短了就从头读
    if (s.size < offset) offset = 0
    if (s.size === offset) return
    const fh = await open(file, 'r')
    try {
      const buf = Buffer.alloc(Math.min(s.size - offset, 4 * 1024 * 1024))
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset)
      offset += bytesRead
      const text = rest + buf.subarray(0, bytesRead).toString('utf8')
      const cut = text.lastIndexOf('\n')
      rest = cut < 0 ? text : text.slice(cut + 1)
      const done = cut < 0 ? '' : text.slice(0, cut)
      if (!done) return
      jobLog(job, done)
      if (RESULT_OK.test(done)) ok = true
      if (RESULT_FAIL.test(done)) fail = true
    } finally {
      await fh.close()
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  const finish = async () => {
    if (timer) clearInterval(timer)
    timer = undefined
    offCancel(job.id)
    await read().catch(() => undefined)
    if (rest.trim()) jobLog(job, rest)
    if (job.status !== 'running') return
    if (job.canceled) return endJob(job, false)
    jobLog(job, t('之前的编译已经结束'))
    if (!ok && !fail) jobLog(job, t('看不到它的退出码，成败以上面的日志为准；要确认的话再编译一次（没改动时很快）'))
    endJob(job, ok && !fail)
  }
  onCancel(job.id, async () => {
    const { failed } = await killProcs(procs)
    for (const f of failed) jobLog(job, t('PID {pid} 没能结束：{msg}', { pid: f.pid, msg: f.msg }))
    await finish()
  })
  timer = setInterval(() => {
    void read()
      .catch(() => undefined)
      .then(() => {
        if (!pids.some(alive)) void finish()
      })
  }, 1000)
  return job
}
