import { useEffect, useState } from 'react'
import { CircleCheck, Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableHit } from '@shared/tables'
import { cellRef } from '@shared/table-edit'
import { tablesApi, type TablesCheck } from '@/lib/tables-api'
import { GroupHeader, ListGroup } from '@/components/layout/ListPane'
import { Button } from '@/components/ui/button'
import { saveText } from '@/lib/save-file'
import { toast } from '@/lib/toast'
import { writeCsv } from '@shared/csv'

/**
 * 表格页左侧的「检查」：整个项目的表格按结构文件查一遍（类型、枚举、引用、范围、主键重复），
 * 按文件 · 工作表分组列出来；点一行打开那个文件、滚到那一格。query 按文件名和字段名筛
 */
export function TableCheckList({
  projectId,
  query,
  seq,
  onOpen,
  onResult,
}: {
  /** 查完了：文件树上标每个文件的不合规数 */
  onResult?: (r: TablesCheck) => void
  projectId: string
  query: string
  /** 结构文件或表格保存后加一：重新查 */
  seq: number
  onOpen: (h: TableHit) => void
}) {
  const [result, setResult] = useState<TablesCheck | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [again, setAgain] = useState(0)
  const [exporting, setExporting] = useState(false)
  /** 导出全部检查结果：重新查一遍、每张表列全部，存成带 BOM 的 CSV（Excel 打开中文不乱码） */
  const exportAll = async () => {
    setExporting(true)
    try {
      const r = await tablesApi.check(projectId, true)
      const rows = [
        [t('文件'), t('工作表'), t('格子'), t('字段'), t('问题')],
        ...r.sheets.flatMap((g) => g.first.map((p) => [g.path, g.sheet, cellRef(p.r, p.c), p.field, p.msg])),
        ...r.failed.map((f) => [f.path, '', '', '', f.error]),
      ]
      const stamp = new Date().toISOString().slice(0, 10)
      saveText(
        `table-check-${stamp}.csv`,
        writeCsv(rows, { delimiter: ',', eol: 'crlf', bom: true }),
        'text/csv;charset=utf-8',
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    tablesApi
      .check(projectId)
      .then((r) => {
        if (!live) return
        setResult(r)
        onResult?.(r)
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // onResult 每次渲染都是新函数，只按项目和重查的信号重查
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, seq, again])

  if (error) return <p className="tb:px-3 tb:py-4 tb:text-footnote tb:text-danger">{error}</p>
  if (!result)
    return (
      <div className="tb:flex tb:justify-center tb:p-6 tb:text-subtle">
        <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />
      </div>
    )
  const q = query.trim().toLowerCase()
  const groups = result.sheets.filter(
    (g) => !q || g.path.toLowerCase().includes(q) || g.first.some((p) => p.field.toLowerCase().includes(q)),
  )
  const total = result.sheets.reduce((n, g) => n + g.count, 0)
  return (
    <div className="tb:flex tb:flex-col tb:gap-1" aria-busy={loading}>
      <div className="tb:flex tb:items-center tb:gap-2 tb:px-2 tb:pt-1 tb:text-caption tb:text-subtle">
        <span className="tb:min-w-0 tb:flex-1">
          {total
            ? t('{files} 个表格查完，{n} 处不合规', { files: result.files, n: total })
            : t('{files} 个表格查完，没有发现问题', { files: result.files })}
        </span>
        {total > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="tb:h-6 tb:px-1.5"
            disabled={exporting}
            title={t('把全部不合规的格子导出成 CSV（Excel / WPS 能直接打开）')}
            onClick={() => void exportAll()}
          >
            {exporting ? <Loader2 className="tb:h-3 tb:w-3 tb:animate-spin" /> : <Download className="tb:h-3 tb:w-3" />}
            {t('导出')}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="tb:h-6 tb:px-1.5" onClick={() => setAgain((n) => n + 1)}>
          {loading ? <Loader2 className="tb:h-3 tb:w-3 tb:animate-spin" /> : <RefreshCw className="tb:h-3 tb:w-3" />}
          {t('重新检查')}
        </Button>
      </div>
      {total === 0 && result.failed.length === 0 && (
        <p className="tb:flex tb:items-center tb:justify-center tb:gap-2 tb:px-3 tb:py-6 tb:text-footnote tb:text-subtle">
          <CircleCheck className="tb:h-4 tb:w-4 tb:text-success" />
          {t('按列的类型、枚举、引用、取值范围和主键查过了')}
        </p>
      )}
      {total > 0 && q && groups.length === 0 && (
        <p className="tb:px-3 tb:py-6 tb:text-center tb:text-footnote tb:text-subtle">
          {t('没有和「{q}」有关的问题', { q: query.trim() })}
        </p>
      )}
      {groups.map((g) => (
        <ListGroup
          key={`${g.path}#${g.sheet}`}
          label={`${g.path} · ${g.sheet}`}
          header={
            <GroupHeader
              compact
              label={
                <span className="tb:flex tb:min-w-0 tb:items-center tb:gap-1.5" title={`${g.path} · ${g.sheet}`}>
                  <FileSpreadsheet className="tb:h-3.5 tb:w-3.5 tb:shrink-0" />
                  <span className="tb:truncate">{g.path.slice(g.path.lastIndexOf('/') + 1)}</span>
                </span>
              }
              count={g.count}
            />
          }
        >
          {g.first.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onOpen({ path: g.path, sheet: g.sheet, row: p.r, col: p.c, text: p.msg })}
              className="tb:flex tb:h-7 tb:w-full tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-row-radius) tb:px-2 tb:text-left tb:text-body tb:hover:bg-sel/60"
            >
              <span className="tb:w-12 tb:shrink-0 tb:font-mono tb:text-caption tb:text-subtle">
                {cellRef(p.r, p.c)}
              </span>
              <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-footnote">
                <span className="tb:font-mono tb:text-muted">{p.field}</span>
                <span className="tb:ml-2 tb:text-danger">{p.msg}</span>
              </span>
            </button>
          ))}
          {g.count > g.first.length && (
            <p className="tb:px-2 tb:py-1 tb:text-caption tb:text-subtle">
              {t('还有 {n} 处，打开文件后点「检查」看全部', { n: g.count - g.first.length })}
            </p>
          )}
        </ListGroup>
      ))}
      {result.failed.map((f) => (
        <p key={f.path} className="tb:px-2 tb:py-1 tb:text-caption tb:text-danger" title={f.error}>
          {t('{path} 打不开：{error}', { path: f.path, error: f.error })}
        </p>
      ))}
    </div>
  )
}
