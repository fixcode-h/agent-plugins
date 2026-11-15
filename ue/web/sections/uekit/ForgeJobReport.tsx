import type { ForgeEntry, ForgeJob } from './Forge.tsx'

/** 桩，右栏会替换：作业报告（点「查看」时主区显示） */
export interface ForgeJobReportRow {
  config?: string
  asset?: string
  succeeded?: boolean
  message?: string
  skipped?: boolean
  seconds?: number
}

export function ForgeJobReport({
  job,
  onClose,
}: {
  job: ForgeJob & { reports?: unknown[] }
  entries: ForgeEntry[]
  onOpen: (key: string) => void
  onClose: () => void
}) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-1 ue:p-6 ue:text-footnote">
      <button type="button" className="ue:text-left ue:font-medium ue:text-fg" onClick={onClose}>
        {job.title}
      </button>
      {((job.reports ?? []) as ForgeJobReportRow[]).map((r, i) => (
        <span key={i} className={r.succeeded ? 'ue:text-muted' : 'ue:text-danger'}>
          {r.config ?? r.asset} {r.message}
        </span>
      ))}
    </div>
  )
}
