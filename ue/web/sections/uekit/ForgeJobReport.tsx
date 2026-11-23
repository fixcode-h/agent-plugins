import { CircleCheck, CircleX, Copy, ExternalLink, History, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { Badge, fmtTime } from '../../ui.tsx'
import type { ForgeEntry, ForgeJob } from './Forge.tsx'

/**
 * 作业报告（设计稿 §2.3、效果图 3）：作业条结束后点「查看」在右栏看这次导入 / 导出每份配置的结果。
 * 以前作业条一结束就消失，失败的是哪几份、为什么，要去日志里找（设计稿问题 8）。
 * 字段照 UEKit 源码：forge.job 的 reports 是 ForgePipeline::ReportToJson 去掉 actions，失败的已排在前面，
 * 最多回 50 份，多的记在 reportsOmitted。UEKit 没有每份的用时，seconds 留着，以后带了就显示「用时」一列。
 */
export interface ForgeJobReportRow {
  /** 配置文件的路径（UEKit 给的是磁盘上的绝对路径） */
  sourcePath?: string
  assetPath?: string
  succeeded?: boolean
  dryRun?: boolean
  created?: number
  updated?: number
  deleted?: number
  diagnostics?: { severity?: string; fieldPath?: string; message?: string }[]
  seconds?: number
}

type Job = ForgeJob & { reports?: unknown[]; reportsOmitted?: number; startedAt?: string; endedAt?: string }

interface Row extends ForgeJobReportRow {
  entry?: ForgeEntry
  /** 表里显示的配置路径：认得出是哪份就用配置根下的相对路径 */
  label: string
  result: string
  changed: boolean
}

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** 报告行 → 对应的配置：绝对路径相同，或以「/相对路径」结尾 */
export function matchEntry(source: string | undefined, entries: ForgeEntry[]) {
  if (!source) return undefined
  const s = norm(source)
  return entries.find(
    (e) =>
      (e.configPath && norm(e.configPath) === s) ||
      (e.config && (s === norm(e.config) || s.endsWith(`/${norm(e.config)}`))),
  )
}

function toRows(reports: unknown[] | undefined, entries: ForgeEntry[]): Row[] {
  return (reports ?? []).map((raw) => {
    const r = raw as ForgeJobReportRow
    const entry = matchEntry(r.sourcePath, entries)
    const changed = !!(r.created || r.updated || r.deleted)
    const err = r.diagnostics?.find((d) => d.severity === 'error') ?? r.diagnostics?.[0]
    const result = !r.succeeded
      ? err?.message || t('失败（没有给原因）')
      : changed
        ? t('新建 {c} · 修改 {u} · 删除 {d} 个节点', { c: r.created ?? 0, u: r.updated ?? 0, d: r.deleted ?? 0 })
        : t('没有改动')
    const label = entry?.config?.replace(/\\/g, '/') ?? r.sourcePath ?? r.assetPath ?? '—'
    return { ...r, entry, label, result, changed }
  })
}

export function ForgeJobReport({
  job,
  entries,
  onOpen,
  onClose,
}: {
  job: Job
  entries: ForgeEntry[]
  onOpen: (key: string) => void
  onClose: () => void
}) {
  const { project } = useUe()
  const { busy, run } = useAction()
  const retry = (rows: Row[]) =>
    run('retry', async () => {
      const configs = rows.map((r) => r.entry?.config ?? r.sourcePath).filter(Boolean)
      if (!configs.length) throw new Error(t('找不到这些配置，刷新一下左栏再试'))
      await op(project.id, 'forge.import', { configs })
      h().toast.success(t('已开始重试 {n} 份', { n: configs.length }))
    })
  return (
    <JobReportView
      job={job}
      rows={toRows(job.reports, entries)}
      busy={!!busy}
      onOpen={onOpen}
      onRetry={(rows) => void retry(rows)}
      onClose={onClose}
    />
  )
}

/** 不取 UE 上下文的那一半：设置 →「组件」的示例用假数据直接画它 */
export function JobReportView({
  job,
  rows,
  busy,
  onOpen,
  onRetry,
  onClose,
}: {
  job: Job
  rows: Row[]
  busy?: boolean
  onOpen: (key: string) => void
  onRetry: (rows: Row[]) => void
  onClose: () => void
}) {
  const { ui, cn } = h()
  const [showQuiet, setShowQuiet] = useState(false)
  const failed = rows.filter((r) => !r.succeeded)
  // 失败的最前，有改动的其次；成功又没改动的默认折成一行，几百份配置里一眼看到出事的那几份
  const loud = [...failed, ...rows.filter((r) => r.succeeded && r.changed)]
  const quiet = rows.filter((r) => r.succeeded && !r.changed)
  const shown = showQuiet ? [...loud, ...quiet] : loud
  const timed = rows.some((r) => r.seconds !== undefined)
  const secs = job.startedAt && job.endedAt ? (Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000 : undefined
  const meta = [
    job.endedAt && fmtTime(job.endedAt),
    secs !== undefined && !Number.isNaN(secs) && t('用时 {s} 秒', { s: secs.toFixed(1) }),
    job.round && t('第 {n} 轮完成', { n: job.round }),
    job.status === 'cancelled' && t('已取消'),
  ].filter(Boolean)
  const menu = (r: Row) => (e: React.MouseEvent) =>
    openMenu(e, [
      r.entry && { label: t('打开这份配置'), icon: ExternalLink, onClick: () => r.entry && onOpen(r.entry.key) },
      { label: t('重试这一份'), icon: RotateCcw, disabled: busy, onClick: () => onRetry([r]) },
      !r.succeeded && { label: t('复制错误'), icon: Copy, onClick: () => copyText(`${r.label}\n${r.result}`) },
    ])
  const grid = cn(
    'ue:grid ue:items-center ue:gap-3 ue:px-5',
    timed
      ? 'ue:grid-cols-[16px_minmax(0,1fr)_minmax(0,1.2fr)_48px]'
      : 'ue:grid-cols-[16px_minmax(0,1fr)_minmax(0,1.2fr)]',
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:min-h-14 ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-5 ue:py-2.5">
        <span className="ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg ue:bg-hover">
          <History className={cn('ue:h-4 ue:w-4', job.failed ? 'ue:text-danger' : 'ue:text-success')} />
        </span>
        <span className="ue:flex ue:min-w-0 ue:flex-col">
          <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{job.title}</span>
          <span className="ue:truncate ue:text-caption ue:text-subtle">{meta.join(' · ')}</span>
        </span>
        <Badge tone="ok">{t('{n} 成功', { n: job.succeeded })}</Badge>
        {job.failed > 0 && <Badge tone="danger">{t('{n} 失败', { n: job.failed })}</Badge>}
        <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1.5">
          {failed.length > 0 && (
            <ui.Button size="sm" variant="secondary" disabled={busy} onClick={() => onRetry(failed)}>
              <RotateCcw className="ue:h-3.5 ue:w-3.5" /> {t('重试失败的 {n} 份', { n: failed.length })}
            </ui.Button>
          )}
          <ui.IconButton icon={X} size="sm" label={t('关掉这份结果')} onClick={onClose} />
        </div>
      </header>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:pb-4">
        <div className={cn(grid, 'ue:bg-sel/35 ue:py-1.5 ue:text-caption ue:text-subtle')}>
          <span />
          <span>{t('配置')}</span>
          <span>{t('结果')}</span>
          {timed && <span className="ue:text-right">{t('用时')}</span>}
        </div>
        {shown.map((r, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => r.entry && onOpen(r.entry.key)}
            onKeyDown={(e) => e.key === 'Enter' && r.entry && onOpen(r.entry.key)}
            onContextMenu={menu(r)}
            className={cn(
              grid,
              'ue:cursor-pointer ue:border-t ue:border-line/60 ue:py-2 ue:text-footnote ue:hover:bg-hover',
              !r.succeeded && 'ue:bg-danger/8',
            )}
          >
            {r.succeeded ? (
              <CircleCheck className="ue:h-4 ue:w-4 ue:text-success" />
            ) : (
              <CircleX className="ue:h-4 ue:w-4 ue:text-danger" />
            )}
            <span className="ue:truncate ue:font-mono ue:text-fg" title={r.sourcePath}>
              {r.label}
            </span>
            <span className={cn('ue:truncate', r.succeeded ? 'ue:text-muted' : 'ue:text-danger')} title={r.result}>
              {r.result}
            </span>
            {timed && (
              <span className="ue:text-right ue:font-mono ue:text-subtle">
                {r.seconds !== undefined ? `${r.seconds.toFixed(1)}s` : '—'}
              </span>
            )}
          </div>
        ))}
        {quiet.length > 0 && !showQuiet && (
          <button
            type="button"
            className="ue:w-full ue:cursor-pointer ue:border-t ue:border-line/60 ue:px-5 ue:py-2 ue:text-left ue:text-footnote ue:text-subtle ue:hover:bg-hover"
            onClick={() => setShowQuiet(true)}
          >
            {t('还有 {n} 份没有改动，点开看', { n: quiet.length })}
          </button>
        )}
        {!rows.length && (
          <p className="ue:px-5 ue:py-3 ue:text-footnote ue:text-subtle">{t('这次作业没有带回每份配置的结果')}</p>
        )}
        {(job.reportsOmitted ?? 0) > 0 && (
          <p className="ue:px-5 ue:py-2 ue:text-footnote ue:text-subtle">
            {t('还有 {n} 份没列出（只带回前 50 份，失败的排在前面）', { n: job.reportsOmitted ?? 0 })}
          </p>
        )}
        <p className="ue:px-5 ue:py-2 ue:text-caption ue:text-subtle">
          {t('点一行跳到那份配置；下一次作业开始或点 × 才清掉这份结果')}
        </p>
      </div>
    </div>
  )
}

/** 示例用：假报告 → 行 */
export { toRows as forgeReportRows }
