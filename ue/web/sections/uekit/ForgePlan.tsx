import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { ErrorBox, Hint, Loading } from './forge-parts.tsx'

/** forge.plan 的 report（UEKit ForgePipeline::ReportToJson） */
export interface PlanReport {
  succeeded?: boolean
  created?: number
  updated?: number
  deleted?: number
  actions?: PlanAction[]
  diagnostics?: { severity: string; fieldPath?: string; message: string }[]
}
interface PlanAction {
  action: string
  nodePath?: string
  nodeName?: string
  detail?: string
}

/** 动作分组：新建 / 修改 / 删除，其余（reorder、unchanged）归「其他」 */
const GROUPS = [
  { id: 'create', label: () => t('新建'), tone: 'ue:text-success' },
  { id: 'update', label: () => t('修改'), tone: 'ue:text-warning' },
  { id: 'delete', label: () => t('删除'), tone: 'ue:text-danger' },
  { id: 'other', label: () => t('其他'), tone: 'ue:text-muted' },
] as const

const groupOf = (a: string) => (a === 'create' || a === 'update' || a === 'delete' ? a : 'other')

/** 导入计划页签条数：动作 + 诊断 */
export const planCount = (r?: PlanReport) => (r ? (r.actions?.length ?? 0) + (r.diagnostics?.length ?? 0) : undefined)

/**
 * 「导入计划」页签：演练导入（不落盘）会做的动作。诊断放最上面（error 红、warning 黄），
 * 动作按新建 / 修改 / 删除分组、可折叠——一份大配置的计划几百行，平铺时找不到要删的那几个节点。
 */
export function ForgePlan({ loading, error, report }: { loading: boolean; error: string; report?: PlanReport }) {
  const { cn } = h()
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (loading && !report) return <Loading />
  if (!report) return null
  const acts = report.actions ?? []
  const diags = report.diagnostics ?? []
  const rowMenu = (text: string) => (e: React.MouseEvent) =>
    openMenu(e, [{ label: t('复制'), icon: Copy, onClick: () => copyText(text) }])
  return (
    <div className="ue:flex ue:flex-col ue:pb-4">
      <p className="ue:px-5 ue:py-2.5 ue:text-footnote ue:text-muted">
        {t('导入会新建 {c}、修改 {u}、删除 {d} 个节点', {
          c: report.created ?? 0,
          u: report.updated ?? 0,
          d: report.deleted ?? 0,
        })}
      </p>
      {diags.map((d, i) => (
        <div
          key={`d${i}`}
          onContextMenu={rowMenu(`${d.fieldPath || ''} ${d.message}`.trim())}
          className={cn(
            'ue:border-t ue:border-line/60 ue:px-5 ue:py-1.5 ue:text-footnote',
            d.severity === 'error' ? 'ue:bg-danger/8 ue:text-danger' : 'ue:bg-warning/8 ue:text-warning',
          )}
        >
          <span className="ue:font-mono">{d.fieldPath || t('文件')}</span> · {d.message}
        </div>
      ))}
      {GROUPS.map((g) => {
        const list = acts.filter((a) => groupOf(a.action) === g.id)
        if (!list.length) return null
        const open = !closed[g.id]
        const Chevron = open ? ChevronDown : ChevronRight
        return (
          <section key={g.id} className="ue:border-t ue:border-line/60">
            <button
              type="button"
              className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-4 ue:py-1.5 ue:text-caption ue:text-muted ue:hover:bg-hover"
              onClick={() => setClosed((c) => ({ ...c, [g.id]: open }))}
            >
              <Chevron className="ue:h-3.5 ue:w-3.5" />
              <span className={cn('ue:font-medium', g.tone)}>{g.label()}</span>
              <span className="ue:tabular-nums ue:text-subtle">{list.length}</span>
            </button>
            {open &&
              list.map((a, i) => (
                <div
                  key={i}
                  onContextMenu={rowMenu([a.action, a.nodePath || a.nodeName, a.detail].filter(Boolean).join(' '))}
                  className="ue:grid ue:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] ue:gap-3 ue:px-5 ue:py-1 ue:text-footnote ue:hover:bg-hover"
                >
                  <span className="ue:font-mono ue:text-subtle">{a.action}</span>
                  <span className="ue:truncate ue:font-mono ue:text-fg" title={a.nodePath}>
                    {a.nodePath || a.nodeName}
                  </span>
                  <span className="ue:truncate ue:text-subtle" title={a.detail}>
                    {a.detail}
                  </span>
                </div>
              ))}
          </section>
        )
      })}
      {!acts.length && !diags.length && <Hint>{t('导入不会改资产')}</Hint>}
    </div>
  )
}
