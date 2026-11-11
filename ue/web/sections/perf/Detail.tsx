import { ExternalLink, MessageSquare, Trash2 } from 'lucide-react'
import { ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, ErrorText, LinkBtn } from '../../ui.tsx'
import { CsvView } from './CsvView.tsx'
import { MemReportView } from './MemView.tsx'
import { Skeleton } from './parts.tsx'
import { PRESETS } from './RecordControls.tsx'
import { TraceView } from './TraceView.tsx'
import type { Capture, CsvSummary, MemSummary } from './types.ts'

/** 一份抓取的详情：顶上一条文件信息和操作，下面 trace / CSV / 内存报告各用自己的视图 */
export function Detail({
  capture,
  canAgent,
  onAgent,
  onDelete,
}: {
  capture: Capture
  canAgent: boolean
  onAgent: (extra: string) => void
  onDelete: () => void
}) {
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-rise">
      <DetailBar capture={capture} canAgent={canAgent} onAgent={onAgent} onDelete={onDelete} />
      {capture.kind === 'trace' ? (
        <TraceView capture={capture} onAgent={canAgent ? onAgent : undefined} />
      ) : (
        <FileSummary capture={capture} onAgent={canAgent ? onAgent : undefined} />
      )}
    </div>
  )
}

const KIND = {
  csv: { tone: 'run', label: () => t('帧数据') },
  memreport: { tone: 'ok', label: () => t('内存报告') },
  trace: { tone: 'accent', label: () => 'trace' },
} as const

function DetailBar({
  capture,
  canAgent,
  onAgent,
  onDelete,
}: {
  capture: Capture
  canAgent: boolean
  onAgent: (extra: string) => void
  onDelete: () => void
}) {
  const { project } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const preset = PRESETS.find((p) => p.value === capture.preset)
  return (
    <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-5 ue:py-2">
      <Badge tone={KIND[capture.kind].tone}>{KIND[capture.kind].label()}</Badge>
      {preset && <Badge tone="muted">{preset.label()}</Badge>}
      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle" title={capture.file}>
        {capture.file}
      </span>
      {capture.kind === 'trace' && (
        <LinkBtn
          disabled={!!busy}
          onClick={() => void run('insights', () => ppost(project.id, 'perf/insights', { id: capture.id }))}
        >
          <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('在 Unreal Insights 里打开')}
        </LinkBtn>
      )}
      {canAgent && capture.kind !== 'trace' && (
        <LinkBtn onClick={() => onAgent('')}>
          <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 分析')}
        </LinkBtn>
      )}
      <ui.IconButton icon={Trash2} tone="danger" label={t('删除')} size="xs" onClick={onDelete} />
    </div>
  )
}

/** CSV 和内存报告：先读摘要 */
function FileSummary({ capture, onAgent }: { capture: Capture; onAgent?: (extra: string) => void }) {
  const { project } = useUe()
  const sum = useLoad(
    () => ppost<{ summary: CsvSummary | MemSummary }>(project.id, 'perf/summary', { id: capture.id }),
    [project.id, capture.id],
  )
  if (sum.error)
    return (
      <div className="ue:p-5">
        <ErrorText>{sum.error}</ErrorText>
      </div>
    )
  if (!sum.data) return <Skeleton rows={6} note={t('正在读文件…')} />
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-fade">
      {capture.kind === 'csv' && <CsvView capture={capture} s={sum.data.summary as CsvSummary} onAgent={onAgent} />}
      {capture.kind === 'memreport' && <MemReportView s={sum.data.summary as MemSummary} />}
    </div>
  )
}
