import { useMemo, useState, useSyncExternalStore } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { t } from '@shared/i18n'
import { extractJson } from '@shared/assist'
import { applyTablesDraft, draftItemIds, resolveTablesProposal, type TablesDraft } from '@shared/tables-assist'
import { TYPE_NAMES } from '@shared/tables'
import type { HeaderRule } from '@shared/table-header'
import { runPromptInProject } from '@/lib/assist-conv'
import { tablesApi } from '@/lib/tables-api'
import { saveTableSchema, useTableSchema } from '@/lib/table-schema'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { roleShort } from '@/components/files/sheet-roles'

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
  const ex = extractJson(reply)
  if (ex.error) return { error: ex.error }
  const r = resolveTablesProposal(ex.json)
  if (!r.proposal) return { error: r.error ?? t('没有找到结果') }
  pending.set(projectId, r.proposal.draft)
  emit()
  toast.success(t('「{title}」的结果已经交回项目设置，可以去应用', { title: t('AI 分析表格风格') }))
  return {}
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
        // 结果回到项目设置的「表格」页勾选，对话右侧不出项目设置的应用面板
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
            try {
              // 在最新的结构文件上并：设置页别的地方刚存的不会被盖掉；存好后上面的「表头」「通用枚举」跟着更新
              await saveTableSchema(projectId, (cur) => applyTablesDraft(cur, draft, picked, new Date().toISOString()))
              pending.delete(projectId)
              emit()
              toast.success(t('已应用到表格设置：上面的表头、通用枚举已经更新，表格页按新的结构显示'))
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        />
      )}
    </div>
  )
}

/** 表头的一句话，带上每行能填什么：「从第 1 行开始：修饰（Modifier）/ 类型（基础类型和通用枚举名）/ 字段」 */
function headerDetail(h: HeaderRule) {
  return t('从第 {n} 行开始：{roles}', {
    n: h.start + 1,
    roles: h.rows
      .map((r) => {
        const name = r.label || roleShort(r.kind)
        if (!r.values) return name
        return `${name}（${r.values === TYPE_NAMES ? t('基础类型和通用枚举名') : r.values}）`
      })
      .join(' / '),
  })
}

/** 一项一行：勾上的才写进去 */
function DraftReview({
  draft,
  onCancel,
  onApply,
}: {
  draft: TablesDraft
  onCancel: () => void
  onApply: (picked: Set<string>) => Promise<void>
}) {
  const ids = useMemo(() => draftItemIds(draft), [draft])
  const [picked, setPicked] = useState(() => new Set(ids))
  const [saving, setSaving] = useState(false)
  const s = draft.style
  const items: { id: string; label: string; detail: string }[] = ids.map((id) => {
    if (id === 'header')
      return { id, label: t('表头（{n} 行）', { n: s.header!.rows.length }), detail: headerDetail(s.header!) }
    if (id === 'arrayMarks') return { id, label: t('表示数组的修饰'), detail: s.arrayMarks!.join(', ') }
    if (id === 'key') return { id, label: t('主键'), detail: s.key! }
    if (id === 'listSep') return { id, label: t('列表分隔符'), detail: s.listSep! }
    if (id === 'primitives') return { id, label: t('基础类型'), detail: s.primitives!.join(', ') }
    if (id.startsWith('ex:')) {
      const e = s.exceptions![Number(id.slice(3))]
      return {
        id,
        label: t('按文件指定：{glob}', { glob: e.sheet ? `${e.glob} · ${e.sheet}` : e.glob }),
        detail: [headerDetail(e.header), e.why].filter(Boolean).join(' · '),
      }
    }
    if (id.startsWith('enum:')) {
      const e = draft.enums[id.slice(5)]
      return {
        id,
        label: t('枚举：{name}', { name: id.slice(5) }),
        detail: e.values.map((v) => v.name).join(', '),
      }
    }
    const c = draft.columns[id.slice(4)]
    return {
      id,
      label: t('列：{key}', { key: id.slice(4).replace('#*#', ' · ') }),
      detail: [
        c.ref && t('引用 {ref}', { ref: c.ref }),
        c.min !== undefined && t('最小 {n}', { n: c.min }),
        c.max !== undefined && t('最大 {n}', { n: c.max }),
        c.allow?.length && t('也允许 {v}', { v: c.allow.join(', ') }),
        c.note,
      ]
        .filter(Boolean)
        .join(' · '),
    }
  })
  return (
    <section aria-label={t('AI 分析结果')} className="tb:rounded-(--c-card-radius) tb:border tb:bg-panel">
      <header className="tb:border-b tb:px-3 tb:py-2.5">
        <p className="tb:text-body tb:font-medium">{t('AI 分析结果')}</p>
        {draft.summary && <p className="tb:mt-0.5 tb:text-footnote tb:text-muted">{draft.summary}</p>}
      </header>
      {items.length === 0 ? (
        <p className="tb:px-3 tb:py-3 tb:text-footnote tb:text-subtle">{t('这次分析没有给出可以写进结构文件的内容')}</p>
      ) : (
        <ul className="tb:max-h-80 tb:divide-y tb:overflow-y-auto">
          {items.map((it) => (
            <li key={it.id} className="tb:flex tb:items-start tb:gap-3 tb:px-3 tb:py-2">
              <Checkbox
                checked={picked.has(it.id)}
                ariaLabel={it.label}
                onChange={(v) =>
                  setPicked((p) => {
                    const n = new Set(p)
                    if (v) n.add(it.id)
                    else n.delete(it.id)
                    return n
                  })
                }
                className="tb:mt-0.5"
              />
              <span className="tb:min-w-0 tb:flex-1">
                <span className="tb:block tb:truncate tb:text-footnote tb:font-medium">{it.label}</span>
                <span className="tb:block tb:truncate tb:font-mono tb:text-caption tb:text-subtle" title={it.detail}>
                  {it.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer className="tb:flex tb:items-center tb:justify-end tb:gap-2 tb:border-t tb:px-3 tb:py-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('不要了')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!picked.size || saving}
          onClick={async () => {
            setSaving(true)
            await onApply(picked)
            setSaving(false)
          }}
        >
          {t('应用到表格设置（{n} 项）', { n: picked.size })}
        </Button>
      </footer>
    </section>
  )
}
