import { ChevronDown, ChevronUp, CircleCheck, CircleX, Hammer, Loader2, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Job } from '../../../../server/types.ts'
import { get, post, useAction, useLoad } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { Term } from '../../../ui.tsx'
import { BuildHint } from '../../BuildHint.tsx'
import { StaleBuildHint } from '../../StaleBuildHint.tsx'

/**
 * UE 插件页底下的作业条：平时一行（最近的安装 / 升级 / 编译、结果、用时），点开看输出；
 * 进行中和失败时自动展开。原来作业输出插在卡片中间，2026-11-16 挪到页底。
 * 作业在服务端内存里，跑着时隔 1.5 秒取一次（和原来 UELink 卡片一样）。
 */
function took(job: Job) {
  if (!job.endedAt) return ''
  const s = Math.max(0, Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000))
  return s < 60 ? t('用时 {s} 秒', { s }) : t('用时 {m} 分 {s} 秒', { m: Math.floor(s / 60), s: s % 60 })
}

/** 取作业：跑着时隔 1.5 秒重取，结束了就不再取 */
export function useJob(jobId: string) {
  const [running, setRunning] = useState(true)
  const job = useLoad(
    () => (jobId ? get<Job>(`/jobs/${jobId}`) : Promise.resolve(undefined)),
    [jobId],
    running ? 1500 : 0,
  )
  const st = job.data?.status
  useEffect(() => setRunning(!st || st === 'running'), [st, jobId])
  return job
}

export function JobBar({
  job,
  onDone,
  onBuild,
  onJob,
}: {
  job: { data?: Job; reload: () => void }
  /** 作业从跑着变成结束：刷新卡片和项目状态 */
  onDone: () => void
  /** 编译（mode：被编辑器挡住时的处理方式） */
  onBuild: (mode?: 'force' | 'kill' | 'killStale') => void
  /** 换成看另一个作业（「接着看」之前的编译） */
  onJob: (id: string) => void
}) {
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const j = job.data
  const [open, setOpen] = useState<boolean>()
  const was = useRef<string>('')
  useEffect(() => {
    if (!j) return
    if (was.current === 'running' && j.status !== 'running') onDone()
    was.current = j.status
    // onDone 每次渲染都是新函数，只在状态变了时调
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [j?.status])
  if (!j) return null
  const expanded = open ?? j.status !== 'done'
  const Icon = j.status === 'running' ? Loader2 : j.status === 'done' ? CircleCheck : CircleX
  const steps = j.steps?.map((s) => `${s.name}${s.status === 'done' ? ' ✓' : s.status === 'failed' ? ' ✗' : ''}`)
  const summary =
    j.status === 'running'
      ? steps
        ? steps.join(' · ')
        : t('进行中')
      : j.canceled
        ? t('已取消')
        : `${j.status === 'done' ? t('完成') : t('失败')}${took(j) ? ` · ${took(j)}` : ''}`
  // 只装了没编：给「编译」（全部升级自动起的编译是更新的作业，作业条会换成显示它）
  const needBuild = j.status === 'done' && j.kind === 'install'
  return (
    <div className="ue:flex ue:flex-col ue:bg-card">
      <div className="ue:flex ue:min-h-11 ue:items-center ue:gap-2 ue:px-4 ue:py-1.5">
        <Icon
          className={cn(
            'ue:h-4 ue:w-4 ue:shrink-0',
            j.status === 'running'
              ? 'ue:animate-spin ue:text-run'
              : j.status === 'done'
                ? 'ue:text-success'
                : 'ue:text-danger',
          )}
        />
        <span className="ue:text-body ue:font-medium ue:text-fg">{j.title}</span>
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">{summary}</span>
        {needBuild && (
          <ui.Button size="sm" variant="secondary" onClick={() => onBuild()}>
            <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('要完整编译一次：编译')}
          </ui.Button>
        )}
        {j.status === 'running' && j.kind === 'build' && !j.canceled && (
          <ui.Button
            size="sm"
            variant="ghost"
            disabled={busy === 'cancel'}
            onClick={() =>
              void run('cancel', async () => {
                await post(`/jobs/${j.id}/cancel`)
                job.reload()
              })
            }
          >
            <Square className="ue:h-3.5 ue:w-3.5" /> {t('取消编译')}
          </ui.Button>
        )}
        <ui.Button size="sm" variant="ghost" onClick={() => setOpen(!expanded)}>
          {expanded ? <ChevronUp className="ue:h-3.5 ue:w-3.5" /> : <ChevronDown className="ue:h-3.5 ue:w-3.5" />}
          {expanded ? t('收起') : t('看输出')}
        </ui.Button>
      </div>
      {expanded && (
        <div className="ue:flex ue:flex-col ue:gap-2 ue:px-4 ue:pb-3">
          {j.hint?.kind === 'live-coding' && (
            <BuildHint hint={j.hint} busy={!!busy} onBuild={(mode) => onBuild(mode === 'normal' ? undefined : mode)} />
          )}
          {/* 排队等别的编译：跑着的作业带 waiting，结束了的是这次没开始 */}
          {j.hint?.kind === 'stale-build' && (j.status === 'running') === !!j.hint.waiting && (
            <StaleBuildHint
              procs={j.hint.procs}
              mode={j.hint.waiting ? 'waiting' : 'blocked'}
              jobId={j.id}
              busy={!!busy}
              onBuild={onBuild}
              onJob={onJob}
              onChanged={job.reload}
            />
          )}
          {/* 换了作业就重新挂载，跟随状态回到「跟到底」；还没有输出时不画空的黑框 */}
          {j.log.length > 0 && (
            <Term key={j.id} follow className="ue:max-h-72 ue:rounded-lg">
              {j.log.slice(-400).map((l, i) => (
                <div
                  key={i}
                  className={/error|失败/i.test(l) ? 'ue:whitespace-pre-wrap ue:text-danger' : 'ue:whitespace-pre-wrap'}
                >
                  {l}
                </div>
              ))}
            </Term>
          )}
        </div>
      )}
    </div>
  )
}
