import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import type { GtHistoryRun } from '../gt-step-history.ts'
import { RunHistory } from './RunHistory.tsx'
import { RunLogList } from './RunLogList.tsx'
import { RunReport } from './RunReport.tsx'
import type { DebugApi } from './use-debug.ts'
import { VarsTable } from './VarsTable.tsx'

type Tab = 'log' | 'vars' | 'report' | 'history'

/**
 * 编辑页右栏的运行面板（效果图 6）：「运行记录 / 变量 / 报告 / 历史」四页，底下贴一块「此刻的变量」（暂停时才有值）。
 * 开跑时外壳把右栏切到它，跑完留着看报告；历史页列这个脚本最近几次运行，点一次看那次的报告
 * （GameTest 页左栏「最近运行」里点一次，也是打开这个脚本并在这里看那次的报告）
 */
export function RunPanel({
  project,
  doc,
  debug,
  onSelect,
  onClose,
  history,
  open,
  disk,
}: {
  project: string
  doc?: GtScript
  debug: DebugApi
  onSelect: (p: GtPath) => void
  onClose: () => void
  /** 这个脚本最近几次运行（gt.history）；旧 GameTest 没有时 undefined */
  history?: GtHistoryRun[]
  /** 外面要看的那次运行（左栏「最近运行」里点的）：n 每点一次加 1，同一次再点也会切过来 */
  open?: { runId: string; n: number }
  disk?: boolean
}) {
  const { ui } = h()
  const [tab, setTab] = useState<Tab>(open ? 'report' : 'log')
  // 报告页看的哪一次：没挑过就是这次编辑里最近跑的那次，再没有就是历史里最新的
  const [picked, setPicked] = useState(open?.runId)
  const { flow } = debug
  useEffect(() => {
    if (!open) return
    setPicked(open.runId)
    setTab('report')
  }, [open])
  // 开跑了：报告换回这次
  useEffect(() => {
    if (flow.active) setPicked(undefined)
  }, [flow.active])
  const runId = picked ?? flow.runId ?? history?.[0]?.runId
  return (
    <div className="ue:flex ue:h-full ue:min-h-0 ue:flex-col">
      <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2">
        <ui.Segmented
          size="sm"
          label={t('运行面板')}
          value={tab}
          onChange={(v: string) => setTab(v as Tab)}
          options={[
            { id: 'log', label: t('运行记录') },
            { id: 'vars', label: t('变量') },
            { id: 'report', label: t('报告') },
            { id: 'history', label: t('历史') },
          ]}
        />
        <ui.IconButton icon={X} size="sm" className="ue:ml-auto" label={t('回到检查器')} onClick={onClose} />
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {tab === 'log' && <RunLogList doc={doc} entries={debug.log.entries} onSelect={onSelect} />}
        {tab === 'vars' && <VarsTable doc={doc} vars={debug.vars} full />}
        {tab === 'report' && (
          <RunReport
            project={project}
            runId={runId}
            active={flow.active && runId === flow.runId}
            doc={doc}
            onSelect={onSelect}
            disk={disk}
          />
        )}
        {tab === 'history' && (
          <RunHistory
            runs={history}
            current={runId}
            onOpen={(id) => {
              setPicked(id)
              setTab('report')
            }}
          />
        )}
      </div>
      {(tab === 'log' || tab === 'report') && (
        <section className="ue:max-h-[40%] ue:shrink-0 ue:overflow-auto ue:border-t ue:border-line">
          <h3 className="ue:px-4 ue:pt-2.5 ue:text-caption ue:text-subtle">{t('此刻的变量')}</h3>
          <VarsTable doc={doc} vars={debug.vars} />
        </section>
      )}
    </div>
  )
}
