import type { BuildProc, Job } from '../../../../server/types.ts'
import { pget, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { StaleBuildHint } from '../../StaleBuildHint.tsx'

/**
 * UE 插件页：这个引擎有面板没在跟踪的编译进程时提一句（面板升级插件、重启前起的编译，或在 VS、命令行里起的），
 * 不等用户点编译后才发现在排队。打开页面和作业状态变了时查一次（查进程要起 PowerShell，不定时轮询）。
 * 作业条上已经在提示同一件事（stale-build）或正在编译时不重复显示。
 */
export function StrayBuilds({ job, onJob }: { job?: Job; onJob: (id: string) => void }) {
  const { project } = useUe()
  const procs = useLoad(
    () => pget<{ procs: BuildProc[]; error?: string }>(project.id, 'build-procs'),
    [project.id, job?.id, job?.status],
  )
  const stray = (procs.data?.procs ?? []).filter((x) => !x.job)
  if (!stray.length || job?.status === 'running' || job?.hint?.kind === 'stale-build') return null
  return (
    <div className="ue:px-4 ue:pb-3">
      <StaleBuildHint procs={stray} mode="idle" busy={false} onJob={onJob} onChanged={() => void procs.reload()} />
    </div>
  )
}
