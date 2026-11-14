import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { t } from '@shared/i18n'
import {
  EnumScan,
  fromWhere,
  isSheetFrom,
  newScanId,
  scanName,
  splitGlobs,
  type ScanState,
} from '@shared/table-enum-scan'
import { withId } from '@shared/table-enum-scan-ai'
import type { TableSchema } from '@shared/tables'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { saveTableSchema } from '@/lib/table-schema'
import { tablesApi } from '@/lib/tables-api'
import { toast, toastError } from '@/lib/toast'
import { EnumScanDialog } from '@/components/tables/EnumScanDialog'
import { scanKindLabel } from '@/components/tables/EnumScanParts'
import { afterScan, clearScanRenames, useScanRenames } from '@/components/tables/use-enum-auto-scan'
import { EnumScanAiDialog, dropScanAiResult, useScanAiResult } from '@/components/tables/EnumScanAi'
import { EnumRenameDialog } from '@/components/tables/EnumRenameDialog'
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
  const [editing, setEditing] = useState<{ rule: EnumScan; tryNow?: boolean; example?: string } | null>(null)
  const [asking, setAsking] = useState<{ rule?: EnumScan } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const aiResult = useScanAiResult(projectId)
  const renames = useScanRenames(projectId)
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
      await afterScan(projectId, cur, runs, false, true)
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
      // 刚保存的就是 AI 总结的那条：提示条收起
      if (editing?.tryNow) dropScanAiResult(projectId)
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
      {aiResult && (
        <Notice icon={Sparkles}>
          <span className="tb:min-w-0 tb:flex-1">
            {t('AI 总结了一条扫描规则「{name}」：先看试跑结果再保存', {
              name: aiResult.draft.name || fromWhere(aiResult.draft.from),
            })}
          </span>
          <Button
            size="sm"
            onClick={() =>
              setEditing({
                rule: withId(aiResult.draft, aiResult.replace ?? newScanId(schema.scans)),
                tryNow: true,
                example: aiResult.example,
              })
            }
          >
            {t('查看并保存')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dropScanAiResult(projectId)}>
            {t('丢掉')}
          </Button>
        </Notice>
      )}
      {!!renames?.length && (
        <Notice icon={Wand2}>
          <span className="tb:min-w-0 tb:flex-1">
            {t('扫描发现 {n} 个成员像是改了名（{first}），表格里可能还写着旧名字', {
              n: renames.length,
              first: `${renames[0].from} → ${renames[0].to}`,
            })}
          </span>
          <Button size="sm" onClick={() => setRenaming(true)}>
            {t('替换表格里的旧值')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => clearScanRenames(projectId)}>
            {t('忽略')}
          </Button>
        </Notice>
      )}
      {schema.scans.length > 0 && (
        <div className="tb:flex tb:flex-col tb:gap-px tb:overflow-hidden tb:rounded-(--c-card-radius) tb:border">
          {schema.scans.map((s) => (
            <EnumScanRow
              key={s.id}
              rule={s}
              state={state[s.id]}
              busy={busy.includes(s.id)}
              onScan={() => scan([s.id])}
              onEdit={() => setEditing({ rule: s })}
              onAi={() => setAsking({ rule: s })}
              onRemove={() => remove(s)}
            />
          ))}
        </div>
      )}
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing({ rule: blank(schema.scans) })}>
          <Plus className="tb:h-3.5 tb:w-3.5" />
          {t('新建扫描')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAsking({})}>
          <Sparkles className="tb:h-3.5 tb:w-3.5" />
          {t('让 AI 总结')}
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
          {t('枚举定义在表格页签、C++ 或 Lua 里时，按规则一次扫出全部枚举；不会写规则就指个示例让 AI 总结。')}
        </span>
      </div>
      {editing && (
        <EnumScanDialog
          projectId={projectId}
          initial={editing.rule}
          tryNow={editing.tryNow}
          example={editing.example}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {asking && (
        <EnumScanAiDialog
          projectId={projectId}
          replace={asking.rule?.id}
          initial={asking.rule ? exampleOf(asking.rule, state[asking.rule.id]) : undefined}
          onClose={() => setAsking(null)}
        />
      )}
      {renaming && renames && (
        <EnumRenameDialog
          projectId={projectId}
          renames={renames}
          onClose={() => setRenaming(false)}
          onApplied={() => clearScanRenames(projectId)}
        />
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
  onAi,
  onRemove,
}: {
  rule: EnumScan
  state?: ScanState
  busy?: boolean
  onScan: () => void
  onEdit: () => void
  /** 让 AI 调整这条规则（组件示例里不给） */
  onAi?: () => void
  onRemove: () => void
}) {
  const where = fromWhere(rule.from)
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
          {onAi && <IconButton icon={Sparkles} size="xs" label={t('让 AI 调整这条规则')} onClick={onAi} />}
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
        <Badge tone={rule.auto === 'off' ? 'neutral' : 'accent'}>
          {rule.auto === 'open' ? t('打开时自动') : rule.auto === 'watch' ? t('盯着改动') : t('只手动')}
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

/** 设置里规则列表上方的提示条（AI 结果、改名） */
function Notice({ icon: Icon, children }: { icon: typeof Sparkles; children: React.ReactNode }) {
  return (
    <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2 tb:rounded-(--c-card-radius) tb:bg-accent-soft tb:px-3 tb:py-2 tb:text-footnote">
      <Icon className="tb:h-4 tb:w-4 tb:shrink-0 tb:text-accent-text" />
      {children}
    </div>
  )
}

/** 「让 AI 调整」时的示例：规则扫的第一个文件 + 现在的规则 + 上次的提醒和错误 */
function exampleOf(rule: EnumScan, state?: ScanState) {
  const f = rule.from
  return {
    file: isSheetFrom(f) ? f.file : (splitGlobs(f.files)[0] ?? ''),
    ...(isSheetFrom(f) && f.sheet ? { sheet: f.sheet } : {}),
    current: rule,
    problems: [...(state?.error ? [state.error] : []), ...(state?.warnings ?? [])],
  }
}
