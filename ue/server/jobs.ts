import type { ChildProcess } from 'node:child_process'
import type { Job } from './types.ts'
import { now, t, uid } from './util.ts'

/**
 * 后台作业（编译、安装）：内存里留最近 30 个，网页轮询看输出。
 * 作业表和子进程表挂在 globalThis 上，不放模块变量：面板升级 UE 插件时会重新 import 插件入口（新模块），
 * 模块变量跟着清空，正在跑的 Build.bat 就没人管了——网页刷新后看不到它，再编译时被它的互斥量挡住一直等
 * （「Build.bat is already running」）。挂在进程上，新旧两份模块看的是同一张表，旧模块里子进程的输出回调照样写进来。
 */
interface JobStore {
  jobs: Map<string, Job & { project: string }>
  /** 正在跑的子进程，取消、认出「这次自己起的进程」时用 */
  children: Map<string, ChildProcess>
  /** 没有自己子进程的作业（接着看的旧编译）取消时做什么 */
  cancels?: Map<string, () => Promise<void>>
}
const g = globalThis as { __agentPanelUeJobs?: JobStore }
const store: JobStore = (g.__agentPanelUeJobs ??= { jobs: new Map(), children: new Map() })
const { jobs, children } = store
const cancels = (store.cancels ??= new Map())

/** 登记作业取消时做的事（作业结束时调 offCancel 撤掉） */
export const onCancel = (id: string, fn: () => Promise<void>) => void cancels.set(id, fn)
export const offCancel = (id: string) => void cancels.delete(id)
const MAX_LOG = 4000

/**
 * 同一条作业也登记到面板的后台作业表（面板 ADR 0075）：侧栏底部看得到「在编译 / 在安装」，能看日志、能取消。
 * UE 页自己的作业条照旧读这里的表（日志、编译进程识别都靠它）；面板那份只是镜像，加载不到（旧面板）就不登记
 */
type PanelJob = import('@panel/server/jobs/registry').JobHandle
const panelJobs = new Map<string, Promise<PanelJob | undefined>>() // 模块状态：运行时，作业结束就删
function mirror(job: Job & { project: string }) {
  panelJobs.set(
    job.id,
    import('@panel/server/jobs/registry')
      .then(({ startJob }) =>
        startJob({
          source: 'ue',
          projectId: job.project,
          kind: job.kind,
          title: job.title,
          cancel: async () => void (await cancelJob(job.id)),
        }),
      )
      .catch(() => undefined),
  )
}
const toPanel = (id: string, fn: (h: PanelJob) => void) => void panelJobs.get(id)?.then((h) => h && fn(h))

/** 跑着的作业的子进程 PID（作业 id → PID），扫编译进程时据此分出「面板起的」和残留的 */
export function jobPids() {
  const out = new Map<number, string>()
  for (const [id, c] of children) if (c.pid && jobs.get(id)?.status === 'running') out.set(c.pid, id)
  return out
}

export function newJob(project: string, kind: Job['kind'], title: string) {
  const job = { id: uid(), project, kind, title, status: 'running' as const, log: [], startedAt: now() }
  jobs.set(job.id, job)
  mirror(job)
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value as string)
  return job as Job & { project: string }
}

export function jobLog(job: Job, text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    job.log.push(line)
  }
  toPanel(job.id, (h) => h.log(text))
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG)
}

export function endJob(job: Job, ok: boolean, code?: number) {
  job.status = ok ? 'done' : 'failed'
  job.code = code
  job.endedAt = now()
  toPanel(job.id, (h) => h.end(ok, ok ? undefined : job.log.at(-1)))
  panelJobs.delete(job.id)
}

export const getJob = (id: string) => jobs.get(id)
export const projectJobs = (project: string) =>
  [...jobs.values()].filter((j) => j.project === project).map(({ project: _p, ...j }) => j)
export const runningJob = (project: string, kind: Job['kind']) =>
  [...jobs.values()].find((j) => j.project === project && j.kind === kind && j.status === 'running')

/** 起一个子进程，输出写进作业（onText 另外看一眼输出）；shell 只在 Windows 跑 .bat 时用（spawn 不能直接执行 .bat） */
export function spawnJob(
  job: Job,
  cmd: string,
  args: string[],
  cwd: string,
  onText?: (text: string) => void,
): Promise<boolean> {
  jobLog(job, `> ${[cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
  return new Promise((resolve) => {
    const bat = process.platform === 'win32' && /\.(bat|cmd)$/i.test(cmd)
    // 经面板的外部进程入口起（ADR 0076）：进孤儿登记，面板被强杀后下次启动会把留下的 Build.bat / UBT 清掉
    void import('@panel/server/exec/tracked').then(
      ({ spawnTracked }) => {
        const o = { cwd, source: 'ue', title: job.title, tag: cmd }
        const child = bat
          ? spawnTracked(`"${cmd}" ${args.map((a) => `"${a}"`).join(' ')}`, [], { ...o, shell: true })
          : spawnTracked(cmd, args, o)
        watch(child)
      },
      (e: Error) => {
        jobLog(job, e.message)
        endJob(job, false)
        resolve(false)
      },
    )
    const watch = (child: ChildProcess) => {
      children.set(job.id, child)
      const out = (d: unknown) => {
        jobLog(job, String(d))
        onText?.(String(d))
      }
      child.stdout?.on('data', out)
      child.stderr?.on('data', out)
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
    }
  })
}

/**
 * 取消正在跑的作业（网页「取消编译」）。Windows 上 .bat 是经 cmd 起的，UBT 是孙进程，
 * 只杀 cmd 的话 UBT 还在编、还占着输出文件，所以用 taskkill /T 连子进程一起结束。
 */
export async function cancelJob(id: string) {
  const job = jobs.get(id)
  if (!job || job.status !== 'running') return false
  const hook = cancels.get(id)
  if (hook) {
    job.canceled = true
    jobLog(job, t('已取消'))
    await hook()
    return true
  }
  const child = children.get(id)
  if (!child?.pid) return false
  job.canceled = true
  jobLog(job, t('已取消'))
  const { stopTree } = await import('@panel/server/exec/tracked')
  const r = await stopTree(child.pid, { waitMs: 15000 })
  if (!r.ok && children.has(id)) jobLog(job, t('没能结束编译进程：{msg}', { msg: r.error ?? '' }))
  return true
}
