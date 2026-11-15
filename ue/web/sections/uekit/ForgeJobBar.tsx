import { CircleCheck, CircleStop, CircleX, Loader2 } from 'lucide-react'
import { h, t } from '../../host.ts'
import type { ForgeJob } from './Forge.tsx'

/**
 * AssetForge 左栏底部的作业条：跑的时候是进度（设计稿 §2.3 之前就有），
 * 跑完换成一行结果「导入 12 份配置 · 11 成功 · 1 失败 · 查看 ›」，不直接消失——
 * 失败的是哪几份、为什么，点「查看」在主区看报告；下一次作业开始或在报告里关掉才清。
 */
export function JobBar({ job, onStop }: { job: ForgeJob; onStop: () => void }) {
  const { ui } = h()
  const pct = job.total ? Math.round((job.finished / job.total) * 100) : 0
  return (
    <>
      <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
        <Loader2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:animate-spin ue:text-warning" />
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium">{job.title}</span>
        <ui.IconButton icon={CircleStop} size="xs" label={t('停止')} onClick={onStop} />
      </div>
      <div className="ue:h-1 ue:overflow-hidden ue:rounded-full ue:bg-sel">
        <div className="ue:h-full ue:bg-run ue:transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span>
        {job.round ? `${t('第 {n} 轮', { n: job.round })} · ` : ''}
        {job.finished} / {job.total} · <Counts job={job} />
        {job.current && ` · ${t('正在处理 {name}', { name: job.current.split('/').pop() ?? job.current })}`}
      </span>
    </>
  )
}

function Counts({ job }: { job: ForgeJob }) {
  return (
    <>
      <span className="ue:text-success">{t('{n} 成功', { n: job.succeeded })}</span>
      {job.failed > 0 && (
        <>
          {' · '}
          <span className="ue:text-danger">{t('{n} 失败', { n: job.failed })}</span>
        </>
      )}
    </>
  )
}

/** 跑完的作业：一行结果，点「查看」打开报告 */
export function JobResult({ job, onView, viewing }: { job: ForgeJob; onView: () => void; viewing: boolean }) {
  const { cn } = h()
  const bad = job.failed > 0 || job.status === 'failed'
  const Icon = bad ? CircleX : CircleCheck
  return (
    <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
      <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', bad ? 'ue:text-danger' : 'ue:text-success')} />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate">
        <span className="ue:font-medium">{job.title}</span>
        {' · '}
        <Counts job={job} />
        {job.status === 'cancelled' && ` · ${t('已停止')}`}
      </span>
      <button
        type="button"
        onClick={onView}
        disabled={viewing}
        className="ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline ue:disabled:cursor-default ue:disabled:text-subtle ue:disabled:no-underline"
      >
        {t('查看 ›')}
      </button>
    </div>
  )
}
