import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { EnumScan, newScanId, scanName, type ScanState } from '@shared/table-enum-scan'
import type { TableSchema } from '@shared/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { saveTableSchema } from '@/lib/table-schema'
import { tablesApi } from '@/lib/tables-api'
import { toast, toastError } from '@/lib/toast'
import { EnumScanDialog } from '@/components/tables/EnumScanDialog'
import { scanKindLabel } from '@/components/tables/EnumScanParts'
import { afterScan } from '@/components/tables/use-enum-auto-scan'
import { when } from '@/components/tables/DraftBar'
import { diffLine } from '@shared/table-enum-scan'

/** 新规则的样子：照用户项目 EnumType 页签的写法（A 枚举名、B 成员名、C 值，没有表头） */
const blank = (have: EnumScan[]): EnumScan =>
  EnumScan.parse({
    id: newScanId(have),
    from: { kind: 'block', file: '', sheet: '', enumCol: 'A', nameCol: 'B', valueCol: 'C' },
  })

/**
 * 项目设置 → 表格 → 枚举的「扫描」：每条规则一行（写法、文件 › 页签、扫出几个枚举、上次什么时候、自动还是手动），
 * 能立即扫、改、删；新建或改完保存后马上扫一次。规则写进结构文件 enum-scans.json，改了就存（和这一页其它部分一样）
 */
export function ProjectTablesScans({ projectId, schema }: { projectId: string; schema: TableSchema }) {
  const [state, setState] = useState<Record<string, ScanState>>({})
  const [editing, setEditing] = useState<EnumScan | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const loadState = useCallback(
    () =>
      tablesApi
        .enumScanState(projectId)
        .then(setState)
        .catch(() => undefined),
    [projectId],
  )
  useEffect(() => {
    void loadState()
  }, [loadState])

  const scan = async (ids: string[], cur: TableSchema = schema) => {
    setBusy(ids)
    try {
      const { runs } = await tablesApi.enumScan(projectId, { ids })
      await afterScan(projectId, cur, runs, false)
      // 手动扫的每条都说一声扫出几个、变了什么（没变化也说，免得以为按钮没反应）；失败的 afterScan 已经报了
      for (const r of runs)
        if (!r.error) {
          const rule = cur.scans.find((s) => s.id === r.id)
          toast.success(
            t('「{name}」扫完了：{n} 个枚举，{what}', {
              name: rule ? scanName(rule) : r.id,
              n: Object.keys(r.enums).length,
              what: diffLine(r.diff),
            }),
          )
        }
    } catch (e) {
      toastError(e)
    } finally {
      setBusy([])
      void loadState()
    }
  }
  const save = async (rule: EnumScan) => {
    try {
      const next = await saveTableSchema(projectId, (cur) => {
        const i = cur.scans.findIndex((s) => s.id === rule.id)
        return { ...cur, scans: i >= 0 ? cur.scans.map((s, j) => (j === i ? rule : s)) : [...cur.scans, rule] }
      })
      setEditing(null)
      await scan([rule.id], next)
    } catch (e) {
      toastError(e)
    }
  }
  const remove = async (rule: EnumScan) => {
    try {
      await saveTableSchema(projectId, (cur) => ({ ...cur, scans: cur.scans.filter((s) => s.id !== rule.id) }))
      // 结果文件里它的那份下次扫描时清掉；先重读一次让扫出来的枚举从列表里消失
      void loadState()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="tb:flex tb:flex-col tb:gap-2">
      {schema.scans.length > 0 && (
        <div className="tb:flex tb:flex-col tb:gap-px tb:overflow-hidden tb:rounded-(--c-card-radius) tb:border">
          {schema.scans.map((s) => (
            <EnumScanRow
              key={s.id}
              rule={s}
              state={state[s.id]}
              busy={busy.includes(s.id)}
              onScan={() => scan([s.id])}
              onEdit={() => setEditing(s)}
              onRemove={() => remove(s)}
            />
          ))}
        </div>
      )}
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(blank(schema.scans))}>
          <Plus className="tb:h-3.5 tb:w-3.5" />
          {t('新建扫描')}
        </Button>
        {schema.scans.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy.length > 0}
            onClick={() => scan(schema.scans.map((s) => s.id))}
          >
            <RefreshCw className="tb:h-3.5 tb:w-3.5" />
            {t('全部扫一遍')}
          </Button>
        )}
        <span className="tb:text-caption tb:text-subtle">
          {t('枚举定义在某个表格页签里时，按规则把整页的枚举扫出来；源头改了重新扫就行。')}
        </span>
      </div>
      {editing && (
        <EnumScanDialog projectId={projectId} initial={editing} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  )
}

/** 一条扫描规则：名字、写法、文件 › 页签；扫出几个枚举、上次什么时候、出错 / 提醒；自动方式；操作 */
export function EnumScanRow({
  rule,
  state,
  busy,
  onScan,
  onEdit,
  onRemove,
}: {
  rule: EnumScan
  state?: ScanState
  busy?: boolean
  onScan: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const where = rule.from.sheet ? `${rule.from.file} › ${rule.from.sheet}` : rule.from.file
  return (
    <div className="tb:flex tb:flex-col tb:gap-1 tb:bg-surface tb:px-3 tb:py-2.5">
      <div className="tb:flex tb:min-w-0 tb:flex-wrap tb:items-center tb:gap-2">
        <span className="tb:text-footnote tb:font-medium">{scanName(rule)}</span>
        <Badge>{scanKindLabel(rule.from.kind)}</Badge>
        <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:font-mono tb:text-caption tb:text-subtle" title={where}>
          {where}
        </span>
        <div className="tb:ml-auto tb:flex tb:shrink-0 tb:items-center tb:gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onScan}>
            {busy ? (
              <Loader2 className="tb:h-3.5 tb:w-3.5 tb:animate-spin" />
            ) : (
              <RefreshCw className="tb:h-3.5 tb:w-3.5" />
            )}
            {t('立即扫描')}
          </Button>
          <IconButton icon={Pencil} size="xs" label={t('改这条扫描规则')} onClick={onEdit} />
          <IconButton icon={Trash2} size="xs" tone="danger" label={t('删掉这条扫描规则')} onClick={onRemove} />
        </div>
      </div>
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-x-2 tb:gap-y-1 tb:text-caption tb:text-muted">
        {state ? (
          <>
            <span>{t('{n} 个枚举', { n: state.enums })}</span>
            <span className="tb:text-subtle">· {when(Date.parse(state.at))}</span>
          </>
        ) : (
          <span className="tb:text-subtle">{t('还没扫过')}</span>
        )}
        <Badge tone={rule.auto === 'open' ? 'accent' : 'neutral'}>
          {rule.auto === 'open' ? t('打开时自动') : t('只手动')}
        </Badge>
        {state?.error && (
          <span className="tb:flex tb:min-w-0 tb:items-center tb:gap-1 tb:text-danger">
            <AlertTriangle className="tb:h-3 tb:w-3 tb:shrink-0" />
            <span className="tb:truncate" title={state.error}>
              {t('上次扫描失败（用的是更早的结果）：{error}', { error: state.error })}
            </span>
          </span>
        )}
        {!state?.error && !!state?.warnings.length && (
          <span className="tb:truncate tb:text-warning" title={state.warnings.join('\n')}>
            {t('{n} 条提醒：{first}', { n: state.warnings.length, first: state.warnings[0] })}
          </span>
        )}
      </div>
    </div>
  )
}
