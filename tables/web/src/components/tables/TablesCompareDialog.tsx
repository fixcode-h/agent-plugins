import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Download, Files, FileSpreadsheet, GitCompareArrows, Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableDoc, TableSchema } from '@shared/tables'
import { copyRows, type DiffRow } from '@shared/sheet-diff'
import { useSheetDiff } from '@/lib/sheet-diff-async'
import { applyRowOps, setCells } from '@shared/table-edit'
import { checkTouched, headerOf, workbookNeeds } from '@shared/table-struct'
import { fieldNames } from '@shared/table-agent'
import { tablesApi, type TablePair } from '@/lib/tables-api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Modal, ModalHeader } from '@/components/ui/modal'
import { Select } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { SheetTabs } from '@/components/files/SheetTable'
import { DiffBothToggle, DiffSummary, SheetDiffView, useDiffBoth, type DiffOnly } from './SheetDiffView'
import { BatchSyncDialog } from './BatchSyncDialog'
import { diffReport, pairsReport } from './compare-report'
import { saveText } from '@/lib/save-file'

type Filter = 'diff' | 'all'

const STATUS: Record<TablePair['status'], { label: () => string; cls: string }> = {
  diff: { label: () => t('有差异'), cls: 'tb:text-warning' },
  left: { label: () => t('只在左边'), cls: 'tb:text-(--c-grid-added)' },
  right: { label: () => t('只在右边'), cls: 'tb:text-(--c-grid-removed)' },
  same: { label: () => t('相同'), cls: 'tb:text-subtle' },
  error: { label: () => t('打不开'), cls: 'tb:text-danger' },
}

/**
 * 跨项目对比（典型是同一个游戏的 Trunk 和 Release 两个工作区）：按相对路径配对两边的表格，
 * 选一个有差异的文件看格子级差异（按主键对齐、按字段名对齐列），勾选行「拷到右边」。
 * 拷之前按右边项目的表格结构检查（枚举值右边有没有、引用的行在不在），有问题列出来让用户决定；
 * 写入走右边项目的原地保存（只改这些格子，文件格式不变，先备份）
 */
export function TablesCompareDialog({
  open,
  onClose,
  left,
  projects,
}: {
  open: boolean
  onClose: () => void
  left: { id: string; name: string }
  /** 别的设了表格目录的项目 */
  projects: { value: string; label: string }[]
}) {
  const [right, setRight] = useState(projects[0]?.value ?? '')
  const [pairs, setPairs] = useState<TablePair[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('diff')
  const [path, setPath] = useState('')
  const [seq, setSeq] = useState(0)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    if (!right) return
    let live = true
    setPairs(null)
    setError('')
    tablesApi
      .compare(left.id, right)
      .then((r) => {
        if (!live) return
        setPairs(r.pairs)
        setPath((p) => p || r.pairs.find((x) => x.status === 'diff')?.path || '')
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [left.id, right, seq])
  const shown = (pairs ?? []).filter((p) => filter === 'all' || p.status !== 'same')
  const count = (s: TablePair['status']) => (pairs ?? []).filter((p) => p.status === s).length
  const rightName = projects.find((p) => p.value === right)?.label ?? ''
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={null}
      bare
      className="tb:h-[min(860px,calc(100dvh-3.75rem))] tb:max-w-[1400px]"
    >
      <ModalHeader icon={GitCompareArrows} title={t('跨项目对比')} meta={t('按相对路径配对，比的是格子内容')} />
      <div className="tb:flex tb:min-h-0 tb:flex-1">
        <nav aria-label={t('对比的文件')} className="tb:flex tb:w-80 tb:shrink-0 tb:flex-col tb:border-r">
          <div className="tb:flex tb:flex-col tb:gap-2 tb:border-b tb:p-3">
            <div className="tb:flex tb:items-center tb:gap-2 tb:text-footnote">
              <span className="tb:w-6 tb:shrink-0 tb:text-subtle">{t('左')}</span>
              <span className="tb:truncate tb:font-medium">{left.name}</span>
            </div>
            <div className="tb:flex tb:items-center tb:gap-2 tb:text-footnote">
              <span className="tb:w-6 tb:shrink-0 tb:text-subtle">{t('右')}</span>
              <Select
                size="sm"
                aria-label={t('右边的项目')}
                value={right}
                onChange={(e) => {
                  setRight(e.target.value)
                  setPath('')
                }}
                options={projects}
                className="tb:min-w-0 tb:flex-1"
              />
            </div>
            {pairs && (
              <p className="tb:flex tb:flex-wrap tb:gap-x-3 tb:gap-y-1 tb:text-caption tb:text-subtle">
                {(['diff', 'left', 'right', 'same'] as const).map((s) => (
                  <span key={s} className={STATUS[s].cls}>
                    {STATUS[s].label()} {count(s)}
                  </span>
                ))}
              </p>
            )}
            {pairs && right && (
              <div className="tb:flex tb:gap-2">
                <Button size="sm" variant="secondary" className="tb:flex-1" onClick={() => setSyncing(true)}>
                  <Files className="tb:h-3.5 tb:w-3.5" />
                  {t('批量同步…')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    saveText(
                      t('对比清单-{l}-{r}.csv', { l: left.name, r: rightName }),
                      pairsReport(pairs, (s) => STATUS[s].label(), left.name, rightName),
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  <Download className="tb:h-3.5 tb:w-3.5" />
                  {t('导出清单')}
                </Button>
              </div>
            )}
            <Segmented
              label={t('列出')}
              size="sm"
              fill
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'diff', label: t('只看不同的') },
                { id: 'all', label: t('全部') },
              ]}
            />
          </div>
          <div className="thin-scroll tb:min-h-0 tb:flex-1 tb:overflow-y-auto tb:p-1.5">
            {error ? (
              <p className="tb:px-2 tb:py-3 tb:text-footnote tb:text-danger">{error}</p>
            ) : !pairs ? (
              <div className="tb:flex tb:justify-center tb:p-6 tb:text-subtle">
                <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />
              </div>
            ) : shown.length === 0 ? (
              <p className="tb:px-2 tb:py-6 tb:text-center tb:text-footnote tb:text-subtle">{t('两边的表格都一样')}</p>
            ) : (
              shown.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  aria-current={p.path === path || undefined}
                  onClick={() => setPath(p.path)}
                  title={p.error ?? p.path}
                  className={cn(
                    'tb:flex tb:h-8 tb:w-full tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-row-radius) tb:px-2 tb:text-left tb:text-body tb:hover:bg-hover',
                    p.path === path && 'tb:bg-sel tb:hover:bg-sel',
                  )}
                >
                  <FileSpreadsheet className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle" />
                  <span className="tb:min-w-0 tb:flex-1 tb:truncate">{p.path}</span>
                  <span className={cn('tb:shrink-0 tb:text-caption', STATUS[p.status].cls)}>
                    {STATUS[p.status].label()}
                  </span>
                </button>
              ))
            )}
          </div>
        </nav>
        <section aria-label={t('文件差异')} className="tb:flex tb:min-w-0 tb:flex-1 tb:flex-col">
          {path && right ? (
            <PairView
              key={`${right}:${path}:${seq}`}
              left={left}
              right={{ id: right, name: rightName }}
              path={path}
              pair={pairs?.find((p) => p.path === path)}
              onCopied={() => setSeq((n) => n + 1)}
            />
          ) : (
            <p className="tb:m-auto tb:text-footnote tb:text-subtle">{t('选左边一个有差异的文件')}</p>
          )}
        </section>
      </div>
      {syncing && pairs && (
        <BatchSyncDialog
          left={left}
          right={{ id: right, name: rightName }}
          pairs={pairs}
          onDone={() => setSeq((n) => n + 1)}
          onClose={() => setSyncing(false)}
        />
      )}
    </Modal>
  )
}

/** 一对文件：左右各读一份，按工作表看差异，勾选行拷到右边 */
function PairView({
  left,
  right,
  path,
  pair,
  onCopied,
}: {
  left: { id: string; name: string }
  right: { id: string; name: string }
  path: string
  pair?: TablePair
  onCopied: () => void
}) {
  const status = pair?.status
  // 两边各自的真实路径：项目目录外的表格目录两边不一样
  const lpath = pair?.left ?? path
  const rpath = pair?.right ?? path
  const [docs, setDocs] = useState<{ l?: TableDoc; r?: TableDoc; schema: TableSchema; rSchema: TableSchema } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [sheetIndex, setSheetIndex] = useState(0)
  const [only, setOnly] = useState(true)
  const [both, setBoth] = useDiffBoth()
  // 摘要里点了「改 / 加 / 删」：只看那一种行
  const [diffOnly, setDiffOnly] = useState<DiffOnly | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState<{ problems: string[]; dropped: string[]; run: () => Promise<void> } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const open = (pid: string, p: string, has: boolean) => (has ? tablesApi.open(pid, p) : Promise.resolve(undefined))
    Promise.all([
      open(left.id, lpath, status !== 'right'),
      open(right.id, rpath, status !== 'left'),
      tablesApi.schema(left.id),
      tablesApi.schema(right.id),
    ])
      .then(([l, r, schema, rSchema]) => live && setDocs({ l, r, schema, rSchema }))
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [left.id, right.id, lpath, rpath, status])

  const sheets = docs?.l?.sheets ?? docs?.r?.sheets ?? []
  const sheet = sheets[Math.min(sheetIndex, Math.max(0, sheets.length - 1))]
  const pairSides = useMemo(() => {
    if (!docs || !sheet) return null
    const side = (doc: TableDoc | undefined, schema: TableSchema, path: string) => {
      const s = doc?.sheets.find((x) => x.name === sheet.name) ?? (doc?.sheets.length === 1 ? doc.sheets[0] : undefined)
      if (!s) return { sheet: undefined, rows: [] as string[][], from: 0, names: [] as string[] }
      const h = headerOf(schema, path, s)
      return { sheet: s, rows: s.rows, from: h.start + h.roles.length, names: fieldNames(s.rows, h) }
    }
    // 差异是 右(旧) → 左(新)：「新增」= 只在左边，「删掉」= 只在右边
    const r = side(docs.r, docs.rSchema, rpath)
    const l = side(docs.l, docs.schema, lpath)
    return { r, l }
  }, [docs, sheet, lpath, rpath])
  const sides = useMemo(() => (pairSides ? { a: pairSides.r, b: pairSides.l } : null), [pairSides])
  // 差异在后台线程算（大表不卡页面）
  const { diff, error: diffError } = useSheetDiff(sides, docs?.schema.style.key)
  const view = pairSides && diff ? { ...pairSides, diff } : null

  if (error || diffError) return <p className="tb:p-4 tb:text-body tb:text-danger">{error || diffError}</p>
  if (!docs || !view)
    return (
      <div className="tb:flex tb:flex-1 tb:items-center tb:justify-center tb:text-subtle">
        <Loader2 className="tb:h-5 tb:w-5 tb:animate-spin" />
      </div>
    )
  const canCopy = !!docs.r && !!view.r.sheet && !docs.r.readOnly && docs.r.kind !== 'xls'
  const pickable = (row: DiffRow) => canCopy && (row.kind === 'add' || row.kind === 'mod')
  const chosen = view.diff.rows.filter((_, i) => picked.has(i))

  const copy = async () => {
    const r = docs.r!
    const target = view.r.sheet!
    const plan = copyRows(view.r.rows, view.l.rows, view.diff, chosen, target.name)
    const after = { name: target.name, rows: setCells(applyRowOps(target.rows, plan.edit.rows), plan.edit.cells) }
    // 右边项目的表格结构：枚举、引用都按右边的查（引用的表从右边读）
    const ext: Record<string, TableDoc['sheets'] | undefined> = {}
    for (const f of workbookNeeds(docs.rSchema, rpath, [after]))
      ext[f] = (await tablesApi.open(right.id, f).catch(() => undefined))?.sheets
    const problems = checkTouched(docs.rSchema, rpath, after, plan.touched, (f) =>
      f === rpath ? r.sheets.map((s) => (s.name === after.name ? after : s)) : ext[f],
    ).map((p) => t('第 {n} 行 {field}：{msg}', { n: p.r + 1, field: p.field, msg: p.msg }))
    const run = async () => {
      setBusy(true)
      try {
        await tablesApi.save(right.id, { path: rpath, mtime: r.mtime, sheets: [plan.edit] })
        toast.success(t('已拷 {n} 行到 {name}', { n: chosen.length, name: right.name }))
        setConfirm(null)
        onCopied()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    }
    setConfirm({ problems, dropped: plan.dropped, run })
  }

  return (
    <>
      {sheets.length > 1 && <SheetTabs sheets={sheets} index={sheetIndex} onChange={setSheetIndex} />}
      <header className="tb:flex tb:shrink-0 tb:flex-wrap tb:items-center tb:gap-3 tb:border-b tb:px-3 tb:py-2">
        <span className="tb:truncate tb:font-mono tb:text-body" title={path}>
          {path.slice(path.lastIndexOf('/') + 1)}
        </span>
        <DiffSummary diff={view.diff} only={diffOnly} onOnly={setDiffOnly} />
        <span className="tb:text-caption tb:text-subtle">
          {t('绿色是只在左边（{l}）的，红色是只在右边（{r}）的', { l: left.name, r: right.name })}
        </span>
        <span className="tb:flex-1" />
        <DiffBothToggle on={both} onChange={setBoth} />
        <Segmented
          label={t('显示')}
          size="sm"
          value={only ? 'only' : 'all'}
          onChange={(v) => setOnly(v === 'only')}
          options={[
            { id: 'only', label: t('只看变化') },
            { id: 'all', label: t('全部行') },
          ]}
        />
        <IconButton
          icon={Download}
          label={t('把这张工作表的差异导出成 CSV')}
          onClick={() =>
            saveText(
              t('差异-{file}.csv', { file: path.slice(path.lastIndexOf('/') + 1) }),
              diffReport(
                sheet.name,
                view.diff,
                view.r.rows,
                view.l.rows,
                view.l.names.length ? view.l.names : view.r.names,
              ),
              'text/csv;charset=utf-8',
            )
          }
        />
        <Button size="sm" variant="primary" disabled={!picked.size || busy} onClick={() => void copy()}>
          {t('把选中行拷到右边')}
          <ArrowRight className="tb:h-3.5 tb:w-3.5" />
        </Button>
      </header>
      {!canCopy && (
        <p className="tb:shrink-0 tb:border-b tb:bg-warning/8 tb:px-3 tb:py-1.5 tb:text-footnote tb:text-warning">
          {!docs.r || !view.r.sheet
            ? t('右边没有这个文件或这张工作表，只能看')
            : (docs.r.readOnly ?? t('右边的文件不能改'))}
        </p>
      )}
      <div className="tb:flex tb:min-h-0 tb:flex-1 tb:flex-col">
        <SheetDiffView
          a={view.r.rows}
          b={view.l.rows}
          diff={view.diff}
          names={view.l.names.length ? view.l.names : view.r.names}
          onlyChanges={only}
          both={both}
          only={diffOnly}
          pick={{
            can: pickable,
            picked,
            onToggle: (i, on) =>
              setPicked((s) => {
                const n = new Set(s)
                if (on) n.add(i)
                else n.delete(i)
                return n
              }),
          }}
        />
      </div>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !busy && setConfirm(null)}
          title={t('拷 {n} 行到 {name}', { n: chosen.length, name: right.name })}
          confirmText={confirm.problems.length ? t('照样拷') : t('拷过去')}
          onConfirm={() => confirm.run()}
          description={
            <div className="tb:flex tb:flex-col tb:gap-2 tb:text-footnote tb:leading-relaxed">
              <p>{t('只改右边这个文件里的这些格子，文件格式不变，写之前先备份。')}</p>
              {confirm.dropped.length > 0 && (
                <p className="tb:text-warning">
                  {t('右边没有这几列，这些值拷不过去：{cols}', { cols: confirm.dropped.join('、') })}
                </p>
              )}
              {confirm.problems.length > 0 && (
                <>
                  <p className="tb:text-danger">
                    {t('按右边项目的表格结构有 {n} 处不合规（例如枚举值右边没有、引用的行不存在）：', {
                      n: confirm.problems.length,
                    })}
                  </p>
                  <ul className="tb:max-h-40 tb:list-disc tb:overflow-y-auto tb:pl-5 tb:text-danger">
                    {confirm.problems.slice(0, 50).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          }
        />
      )}
    </>
  )
}
