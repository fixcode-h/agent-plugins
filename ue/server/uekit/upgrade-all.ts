import { detect } from '../detect.ts'
import { build, install } from '../install.ts'
import { endJob, jobLog, newJob, runningJob } from '../jobs.ts'
import { patchProject } from '../registry.ts'
import type { InstallMode, Job, UeProject } from '../types.ts'
import { UELINK } from '../uelink.ts'
import { now, t } from '../util.ts'
import { installExtension } from './install-ext.ts'

/**
 * UE 插件页「全部升级」：一个总作业里按依赖顺序串起来（UELink 先，扩展要的 UELink 版本靠它），
 * 每一步还是原来的安装作业（日志抄进总作业），一步失败就停下不往后装；都装好后按需起一次完整编译。
 * 马上返回总作业，网页按 steps 显示每张卡片在升级 / 排队。
 */
export interface UpgradePlan {
  /** 要升级 UELink 时给：prerelease 为空 = 正式版和自带的取高 */
  uelink?: { prerelease?: string }
  /** 要升级的扩展和目标版本 */
  extensions: { name: string; version?: string; mode?: InstallMode }[]
  /** 作业标题（网页按单个安装 / 全部升级给），不给时叫「全部升级」 */
  title?: string
  /** 装完自动编译一次（默认开） */
  build?: boolean
}

export function upgradeAll(p: UeProject, plan: UpgradePlan) {
  const busy = runningJob(p.id, 'install')
  if (busy) return busy
  const job = newJob(p.id, 'install', plan.title || t('全部升级'))
  const steps: Job['steps'] = [
    ...(plan.uelink ? [{ name: UELINK, status: 'wait' as const }] : []),
    ...plan.extensions.map((x) => ({ name: x.name, status: 'wait' as const })),
  ]
  job.steps = steps
  void (async () => {
    const mode: InstallMode = p.install?.mode === 'vcs' ? 'vcs' : 'local'
    for (const step of steps) {
      step.status = 'run'
      let sub: Job | undefined
      try {
        if (step.name === UELINK) {
          sub = await install(p, mode, plan.uelink?.prerelease ?? '')
          const det = await detect(p.root, p.engineDir)
          await patchProject(p.id, { install: { mode, version: det.bridge, at: now() } })
        } else {
          const x = plan.extensions.find((e) => e.name === step.name)
          sub = await installExtension(p, step.name, { version: x?.version, mode: x?.mode })
        }
      } catch (e) {
        // install() 失败会抛（日志已写进它自己的作业）
        jobLog(job, (e as Error).message)
      }
      for (const l of sub?.log ?? []) jobLog(job, `[${step.name}] ${l}`)
      if (sub?.status !== 'done') {
        step.status = 'failed'
        jobLog(job, t('{name} 没装好，后面的不再升级', { name: step.name }))
        endJob(job, false)
        return
      }
      step.status = 'done'
    }
    if (plan.build !== false) {
      jobLog(job, t('都装好了，开始完整编译'))
      await build(p)
    } else jobLog(job, t('都装好了：要完整编译一次（Live Coding 不够），再重启编辑器'))
    endJob(job, true)
  })()
  return job
}
