import { spawn } from 'node:child_process'
import type { Job } from './types.ts'
import { now, uid } from './util.ts'

/** 后台作业（编译、安装）：内存里留最近 30 个，网页轮询看输出 */
const jobs = new Map<string, Job & { project: string }>()
const MAX_LOG = 4000

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
    child.stdout?.on('data', (d) => jobLog(job, String(d)))
    child.stderr?.on('data', (d) => jobLog(job, String(d)))
    child.on('error', (e) => {
      jobLog(job, e.message)
      endJob(job, false)
      resolve(false)
    })
    child.on('close', (code) => {
      endJob(job, code === 0, code ?? -1)
      resolve(code === 0)
    })
  })
}
