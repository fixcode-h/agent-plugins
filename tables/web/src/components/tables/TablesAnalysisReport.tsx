import { useEffect, useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { t } from '@shared/i18n'
import { extractJson } from '@shared/assist'
import { resolveTablesProposal, tablesJsonOf } from '@shared/tables-assist'
import { tablesApi } from '@/lib/tables-api'
import { Button } from '@/components/ui/button'
import { applyAnalysis } from './TablesAnalyze'
import { DraftReview } from './TablesDraftReview'

/**
 * 应用过的分析回复（按消息 id，本机记）：再打开这个分析对话时右侧显示「已应用」，不再摆一遍勾选列表。
 * 只是界面上的提示，不影响结构文件；记最近 50 条
 */
const APPLIED_KEY = 'agent-panel:tables-analysis-applied'
const readApplied = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const markApplied = (id: string) => {
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify([...readApplied().filter((x) => x !== id), id].slice(-50)))
  } catch {
    // 存不了（隐私模式、存满）就只在这次打开里记着
  }
}

/**
 * AI 分析窗口右侧功能面板里的「表格设置」（面板 WebPlugin.reports）：读这条回复里的 tables-style 代码块，
 * 逐项勾选后直接写进项目的表格结构文件，不用再回项目设置去找。和项目设置「表格」页底下的是同一个勾选列表
 */
export function TablesAnalysisReport({
  task,
  messageId,
  text,
}: {
  task: { projectId: string; messages?: { id: string; role: string; text: string; at?: string }[] }
  messageId: string
  text: string
}) {
  const parsed = useMemo(() => {
    const ex = tablesJsonOf(text, extractJson)
    if (ex.error) return { error: ex.error }
    const r = resolveTablesProposal(ex.json)
    return r.proposal ? { draft: r.proposal.draft } : { error: r.error ?? t('没有找到结果') }
  }, [text])
  const [applied, setApplied] = useState(() => readApplied().includes(messageId))
  // 面板只画最新一条带结果块的回复：后面还有回复却没给新的结果块（用户补充后 AI 只用文字说了改什么），
  // 这里摆的还是旧结果，照实提醒，免得用户以为补充的内容已经在里面了（用户 2026-11-16）
  const msgs = task.messages ?? []
  const idx = msgs.findIndex((m) => m.id === messageId)
  const stale = idx >= 0 && msgs.slice(idx + 1).some((m) => m.role === 'agent' && m.text.trim())
  // 最新的结果存进项目（analysis.json）：别的分支、别的同事不用重新分析。旧回复不存，更旧的时间服务端也会挡掉
  const [store, setStore] = useState<{ ok?: boolean; error?: string }>({})
  const at = msgs[idx]?.at
  useEffect(() => {
    if (!parsed.draft || stale || !task.projectId) return
    let live = true
    tablesApi
      .saveAnalysis(task.projectId, { at: at ?? new Date().toISOString(), messageId, draft: parsed.draft })
      .then(() => live && setStore({ ok: true }))
      .catch((e) => live && setStore({ error: (e as Error).message }))
    return () => {
      live = false
    }
  }, [task.projectId, messageId, parsed, stale, at])
  const storeNote = store.error ? (
    <p className="tb:px-[1.125rem] tb:pt-3 tb:text-footnote tb:text-danger">
      {t('结果没能存进项目：{error}', { error: store.error })}
    </p>
  ) : store.ok ? (
    <p className="tb:px-[1.125rem] tb:pt-3 tb:text-footnote tb:text-subtle">
      {t('结果已存进项目（结构文件目录的 analysis.json），提交后别的分支在项目设置 → 表格 → AI 分析里直接应用。')}
    </p>
  ) : null
  const staleNote = stale && (
    <p className="tb:px-[1.125rem] tb:pt-3 tb:text-footnote tb:text-warning">
      {t('后面的回复没有给出新的结果，下面还是之前那次的。可以在对话里让它重新输出完整的结果。')}
    </p>
  )

  if (!task.projectId) return null
  if (!parsed.draft)
    return (
      <div className="tb:space-y-2 tb:px-[1.125rem] tb:py-3">
        {stale && (
          <p className="tb:text-footnote tb:text-warning">
            {t('后面的回复没有给出新的结果，下面还是之前那次的。可以在对话里让它重新输出完整的结果。')}
          </p>
        )}
        <p className="tb:text-footnote tb:text-danger">{t('分析结果读不出来：{error}', { error: parsed.error })}</p>
        <p className="tb:text-footnote tb:text-subtle">{t('可以在对话里让它按要求重新输出结果。')}</p>
      </div>
    )
  if (applied)
    return (
      <>
        {staleNote}
        <div className="tb:flex tb:items-start tb:gap-3 tb:px-[1.125rem] tb:py-3">
          <CircleCheck className="tb:mt-0.5 tb:h-4 tb:w-4 tb:shrink-0 tb:text-success" />
          <div className="tb:min-w-0 tb:flex-1 tb:space-y-2">
            <p className="tb:text-footnote">
              {t('这次分析的结果已经应用到表格设置，项目设置的「表格」页和表格页都按新的结构显示。')}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setApplied(false)}>
              {t('重新勾选')}
            </Button>
          </div>
        </div>
      </>
    )
  return (
    <>
      {staleNote}
      {storeNote}
      <div className="tb:px-[1.125rem] tb:py-3">
        <DraftReview
          fill
          draft={parsed.draft}
          onApply={async (picked) => {
            if (!(await applyAnalysis(task.projectId, parsed.draft, picked))) return
            markApplied(messageId)
            setApplied(true)
          }}
        />
      </div>
    </>
  )
}
