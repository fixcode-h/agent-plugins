import { type ChildProcess, spawn } from 'node:child_process'
import type { Job } from './types.ts'
import { now, run, t, uid } from './util.ts'

/** 后台作业（编译、安装）：内存里留最近 30 个，网页轮询看输出 */
const jobs = new Map<string, Job & { project: string }>()
const MAX_LOG = 4000
/** 正在跑的子进程，取消时用 */
const children = new Map<string, ChildProcess>()

export function newJob(project: string, kind: Job['kind'], title: string) {
  const job = { id: uid(), project, kind, title, status: 'running' as const, log: [], startedAt: now() }
  jobs.set(job.id, job)
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value as string)
  return job as Job & { project: string }
}

export function jobLog(job: Job, text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    job.log.push(line)
  }
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG)
}

export function endJob(job: Job, ok: boolean, code?: number) {
  job.status = ok ? 'done' : 'failed'
  job.code = code
  job.endedAt = now()
}

export const getJob = (id: string) => jobs.get(id)
export const projectJobs = (project: string) =>
  [...jobs.values()].filter((j) => j.project === project).map(({ project: _p, ...j }) => j)
export const runningJob = (project: string, kind: Job['kind']) =>
  [...jobs.values()].find((j) => j.project === project && j.kind === kind && j.status === 'running')

/** 起一个子进程，输出写进作业；shell 只在 Windows 跑 .bat 时用（spawn 不能直接执行 .bat） */
export function spawnJob(job: Job, cmd: string, args: string[], cwd: string): Promise<boolean> {
  jobLog(job, `> ${[cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
  return new Promise((resolve) => {
    const bat = process.platform === 'win32' && /\.(bat|cmd)$/i.test(cmd)
    const child = bat
      ? spawn(`"${cmd}" ${args.map((a) => `"${a}"`).join(' ')}`, { cwd, shell: true, windowsHide: true })
      : spawn(cmd, args, { cwd, windowsHide: true })
    children.set(job.id, child)
    child.stdout?.on('data', (d) => jobLog(job, String(d)))
    child.stderr?.on('data', (d) => jobLog(job, String(d)))
    child.on('error', (e) => {
      jobLog(job, e.message)
      endJob(job, false)
      resolve(false)
    })
    child.on('close', (code) => {
      children.delete(job.id)
      endJob(job, !job.canceled && code === 0, code ?? -1)
      resolve(code === 0)
    })
  })
}

/**
 * 取消正在跑的作业（网页「取消编译」）。Windows 上 .bat 是经 cmd 起的，UBT 是孙进程，
 * 只杀 cmd 的话 UBT 还在编、还占着输出文件，所以用 taskkill /T 连子进程一起结束。
 */
export async function cancelJob(id: string) {
  const job = jobs.get(id)
  if (!job || job.status !== 'running') return false
  const child = children.get(id)
  if (!child?.pid) return false
  job.canceled = true
  jobLog(job, t('已取消'))
  if (process.platform === 'win32') {
    const r = await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15000 })
    if (r.code !== 0 && children.has(id)) jobLog(job, t('没能结束编译进程：{msg}', { msg: (r.err || r.out).trim() }))
  } else child.kill('SIGTERM')
  return true
}
