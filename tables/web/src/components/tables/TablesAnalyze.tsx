import { useState, useSyncExternalStore } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { t } from '@shared/i18n'
import { extractJson } from '@shared/assist'
import { applyTablesDraft, resolveTablesProposal, tablesJsonOf, type TablesDraft } from '@shared/tables-assist'
import { DraftReview } from './TablesDraftReview'
import { runPromptInProject } from '@/lib/assist-conv'
import { tablesApi } from '@/lib/tables-api'
import { saveTableSchema, useTableSchema } from '@/lib/table-schema'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'

/**
 * AI 分析表格的结果：对话可能跑几分钟，设置关了也要留着，所以记在模块里（按项目），
 * 回到项目设置的「表格」页再勾选应用。也存一份在本机浏览器里：刷新页面、重开面板后还能接着应用
 */
const STORE_KEY = 'agent-panel:tables-analysis'
const pending = new Map<string, TablesDraft>(loadPending())
const subs = new Set<() => void>()
const emit = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(pending)))
  } catch {
    // 存不了（隐私模式、存满）就只记在内存里
  }
  subs.forEach((f) => f())
}
function loadPending(): [string, TablesDraft][] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>
    return Object.entries(raw).flatMap(([id, d]) => {
      // 旧版存下的结果（几套表头的旧格式）也按 AI 的输出理一遍，换成新格式
      const p = resolveTablesProposal(d).proposal
      return p ? [[id, p.draft] as [string, TablesDraft]] : []
    })
  } catch {
    return []
  }
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

/** 这个项目有没有还没处理的 AI 分析结果（项目设置「AI 分析」子页签上的小红点） */
export const useTablesAnalysisPending = (projectId: string | undefined) =>
  useSyncExternalStore(subscribe, () => !!projectId && pending.has(projectId))

/**
 * 对话做完交回的最后一条回复：解析出 JSON、校验成表格风格，记下等用户回到项目设置勾选（设置开着关着都行）。
 * 格式不对返回 error，对话自己修正一次（runPromptInProject）
 */
function deliverTables(projectId: string, reply: string): { error?: string } {
  const ex = tablesJsonOf(reply, extractJson)
  if (ex.error) return { error: ex.error }
  const r = resolveTablesProposal(ex.json)
  if (!r.proposal) return { error: r.error ?? t('没有找到结果') }
  pending.set(projectId, r.proposal.draft)
  emit()
  toast.success(t('「{title}」的结果可以在分析窗口右侧或项目设置的「表格」页应用', { title: t('AI 分析表格风格') }))
  return {}
}

/**
 * 把勾上的几项写进结构文件：在最新的结构文件上并，设置页别的地方刚存的不会被盖掉；
 * 存好后项目设置的「表头」「通用枚举」、表格页跟着更新。项目设置和分析窗口右侧都走这里，应用了就清掉暂存的结果
 */
export async function applyAnalysis(projectId: string, draft: TablesDraft, picked: Set<string>) {
  try {
    await saveTableSchema(projectId, (cur) => applyTablesDraft(cur, draft, picked, new Date().toISOString()))
    pending.delete(projectId)
    emit()
    toast.success(t('已应用到表格设置：表头、通用枚举已经更新，表格页按新的结构显示'))
    return true
  } catch (e) {
    toast.error((e as Error).message)
    return false
  }
}

/**
 * 项目设置「表格」页底下的 AI 分析：读几张表的样本，在项目里开一个对话让 AI 总结风格，
 * 结果逐项勾选后写进结构文件（不经过「确认」，结构文件不在项目设置里）
 */
export function TablesAnalyze({ projectId, projectName }: { projectId: string; projectName: string }) {
  const draft = useSyncExternalStore(subscribe, () => pending.get(projectId))
  const { schema } = useTableSchema(projectId)
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      // 先读一次样本：表格目录还空着时马上提示，不开一个注定白跑的对话
      const sample = await tablesApi.sample(projectId)
      if (!sample.text.trim()) throw new Error(t('表格目录里还没有能读的表格'))
      runPromptInProject({
        projectId,
        title: t('AI 分析表格风格：{name}', { name: projectName }),
        prompt: async () => (await tablesApi.analyzePrompt(projectId)).prompt,
        // 记成 run：右侧功能面板不画面板自己的「项目设置」，按回复里的 tables-style 代码块画本插件的应用面板
        //（web/index.tsx 的 reports）；旧面板没有这个扩展点，结果照样回到项目设置的「表格」页勾选
        analysis: 'run',
        resolve: async (reply) => deliverTables(projectId, reply),
      })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tb:space-y-3">
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-3">
        <p className="tb:min-w-0 tb:flex-1 tb:text-footnote tb:leading-relaxed tb:text-subtle">
          {schema?.analyzedAt
            ? t('上次分析：{time}。表格加了新类型、换了表头写法时可以再分析一次。', {
                time: new Date(schema.analyzedAt).toLocaleString(),
              })
            : t(
                '让 AI 读几张表的开头几行，自己总结出项目的表头配置（共几行、每行是什么、叫什么、能填什么）、主键、列表分隔符、哪些类型是枚举、哪些列引用别的表，你勾选确认后才写进去。',
              )}
        </p>
        <Button size="sm" onClick={() => void start()} disabled={busy}>
          {busy ? (
            <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />
          ) : (
            <Sparkles className="tb:h-3.5 tb:w-3.5" />
          )}
          {t('AI 分析')}
        </Button>
      </div>
      {draft && schema && (
        <DraftReview
          draft={draft}
          onCancel={() => {
            pending.delete(projectId)
            emit()
          }}
          onApply={async (picked) => {
            await applyAnalysis(projectId, draft, picked)
          }}
        />
      )}
    </div>
  )
}
