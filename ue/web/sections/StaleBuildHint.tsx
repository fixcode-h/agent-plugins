import { Eye, Hammer, Power, Square } from 'lucide-react'
import { useState } from 'react'
import type { BuildProc } from '../../server/types.ts'
import { ppost, post } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Confirm, Note } from '../ui.tsx'

/**
 * 这个引擎还有别的编译在跑时的说明和处理方式（server/build/）。三种场合：
 * - blocked：编译前查到了，这次没开始。给「接着看它编」和「结束旧的再编译」。
 * - waiting：这次已经开始，正排在旧的后面等。给「结束旧的，这次接着编」和「取消这次，看旧的」。
 * - idle：没在编译，UE 插件页上发现没人跟踪的编译进程（面板升级插件、重启前起的，或在 VS、命令行里起的）。
 * 结束进程先确认：旧的编译做到一半的会白做；确认后直接执行。
 */
export function StaleBuildHint({
  procs,
  mode,
  jobId,
  busy,
  onBuild,
  onJob,
  onChanged,
}: {
  procs: BuildProc[]
  mode: 'blocked' | 'waiting' | 'idle'
  /** waiting 时是排着队的这次作业 */
  jobId?: string
  busy: boolean
  onBuild?: (mode: 'killStale') => void
  /** 开始看另一个作业（接着看的旧编译） */
  onJob: (id: string) => void
  onChanged?: () => void
}) {
  const { project } = useUe()
  const { ui, toast } = h()
  const [confirm, setConfirm] = useState(false)
  const [doing, setDoing] = useState(false)
  const pids = procs.map((x) => x.pid)
  const who = procs
    .map(
      (x) =>
        `${x.kind === 'script' ? 'Build.bat' : 'UnrealBuildTool'} PID ${x.pid}${
          x.project ? ` · ${x.same ? t('本项目') : x.project}` : ''
        }${x.job ? ` · ${t('面板在跟踪')}` : ''}`,
    )
    .join('、')

  const act = async (fn: () => Promise<void>) => {
    setDoing(true)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDoing(false)
    }
  }
  const watch = () =>
    act(async () => {
      if (mode === 'waiting' && jobId) await post(`/jobs/${jobId}/cancel`)
      const r = await ppost<{ job?: string; error?: string }>(project.id, 'build-procs/watch', { pids })
      if (r.error) throw new Error(r.error)
      if (r.job) onJob(r.job)
    })
  const kill = () =>
    act(async () => {
      if (mode === 'blocked') return onBuild?.('killStale')
      const r = await ppost<{ failed: { pid: number; msg: string }[]; note?: string }>(project.id, 'build-procs/kill', {
        pids,
      })
      if (r.failed.length)
        toast.error(t('没能结束：{list}', { list: r.failed.map((f) => `PID ${f.pid} ${f.msg}`).join('；') }))
      else toast.success(r.note ?? t('已结束之前的编译'))
      onChanged?.()
    })

  const lead =
    mode === 'waiting'
      ? t('这次编译排在别的编译后面等着（{list}）：同一个引擎同时只能有一个编译。', { list: who })
      : mode === 'blocked'
        ? t('这个引擎还有编译在跑（{list}），新的编译会排在它后面一直等，这次没有开始。', { list: who })
        : t('这个引擎有面板没在跟踪的编译在跑（{list}），再编译会排在它后面一直等。', { list: who })
  const killText =
    mode === 'blocked' ? t('结束旧的再编译') : mode === 'waiting' ? t('结束旧的，这次接着编') : t('结束这些编译')

  return (
    <Note>
      <div className="ue:flex ue:flex-col ue:gap-2">
        <div className="ue:font-medium">{t('还有编译在跑')}</div>
        <div className="ue:text-subtle">
          {lead}{' '}
          {t('多半是面板升级插件、重启前起的，或者在 VS、命令行里起的；它的输出接不回来，「接着看」改读 UBT 的日志。')}
        </div>
        <div className="ue:flex ue:flex-wrap ue:gap-2">
          <ui.Button size="sm" disabled={busy || doing} onClick={() => void watch()}>
            {mode === 'waiting' ? <Square className="ue:h-3.5 ue:w-3.5" /> : <Eye className="ue:h-3.5 ue:w-3.5" />}{' '}
            {mode === 'waiting' ? t('取消这次，看旧的') : t('接着看它编')}
          </ui.Button>
          <ui.Button size="sm" variant="danger-outline" disabled={busy || doing} onClick={() => setConfirm(true)}>
            {mode === 'blocked' ? <Hammer className="ue:h-3.5 ue:w-3.5" /> : <Power className="ue:h-3.5 ue:w-3.5" />}{' '}
            {killText}
          </ui.Button>
        </div>
      </div>
      <Confirm
        open={confirm}
        title={t('结束之前的编译？')}
        okText={killText}
        danger
        onCancel={() => setConfirm(false)}
        onOk={() => {
          setConfirm(false)
          void kill()
        }}
      >
        {t('会结束这些编译进程和它们起的编译器：{list}。做到一半的编译会白做，下次编译从头增量编。', { list: who })}
        {mode === 'blocked' ? ` ${t('结束后马上开始这次编译。')}` : ''}
      </Confirm>
    </Note>
  )
}
