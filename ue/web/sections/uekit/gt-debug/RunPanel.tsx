import { X } from 'lucide-react'
import { useState } from 'react'
import type { GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { RunLogList } from './RunLogList.tsx'
import { RunReport } from './RunReport.tsx'
import type { DebugApi } from './use-debug.ts'
import { VarsTable } from './VarsTable.tsx'

type Tab = 'log' | 'vars' | 'report'

/**
 * 编辑页右栏的运行面板（效果图 6）：「运行记录 / 变量 / 报告」三页，底下贴一块「此刻的变量」（暂停时才有值）。
 * 开跑时外壳把右栏换成它，跑完留着看报告，关掉回到检查器
 */
export function RunPanel({
  project,
  doc,
  debug,
  onSelect,
  onClose,
}: {
  project: string
  doc?: GtScript
  debug: DebugApi
  onSelect: (p: GtPath) => void
  onClose: () => void
}) {
  const { ui } = h()
  const [tab, setTab] = useState<Tab>('log')
  const { flow } = debug
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
          ]}
        />
        <ui.IconButton icon={X} size="sm" className="ue:ml-auto" label={t('关掉，回到检查器')} onClick={onClose} />
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {tab === 'log' && <RunLogList doc={doc} entries={debug.log.entries} onSelect={onSelect} />}
        {tab === 'vars' && <VarsTable doc={doc} vars={debug.vars} full />}
        {tab === 'report' && (
          <RunReport project={project} runId={flow.runId} active={flow.active} doc={doc} onSelect={onSelect} />
        )}
      </div>
      {tab !== 'vars' && (
        <section className="ue:max-h-[40%] ue:shrink-0 ue:overflow-auto ue:border-t ue:border-line">
          <h3 className="ue:px-4 ue:pt-2.5 ue:text-caption ue:text-subtle">{t('此刻的变量')}</h3>
          <VarsTable doc={doc} vars={debug.vars} />
        </section>
      )}
    </div>
  )
}
