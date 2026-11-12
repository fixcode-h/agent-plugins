import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/** 选中超过这么多格就只数格子、不求和：几十万格一格格 parseFloat 会掉帧 */
const STAT_MAX = 200_000

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 })

/** 选中的一片里的数字：个数、求和、平均、最小、最大 */
export function selectionStats(rows: string[][], sel: { rows: number[]; cols: number[] } | null) {
  if (!sel) return null
  const cells = sel.rows.length * sel.cols.length
  if (cells <= 1) return null
  if (cells > STAT_MAX) return { cells, nums: 0, sum: 0, min: 0, max: 0, skipped: true }
  let nums = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (const r of sel.rows) {
    const row = rows[r]
    if (!row) continue
    for (const c of sel.cols) {
      const v = row[c]
      if (!v) continue
      const n = Number(v)
      if (!Number.isFinite(n) || !v.trim()) continue
      nums++
      sum += n
      if (n < min) min = n
      if (n > max) max = n
    }
  }
  return { cells, nums, sum, min, max, skipped: false }
}

/**
 * 表格页底部的状态栏：当前格和字段、表头说明 | 选中区域的统计、筛选后几行 | 检查状态、没保存的改动、文件格式。
 * 统计只在选中两格以上时算，超过 STAT_MAX 格只数格子
 */
export function TableStatusBar({
  cell,
  header,
  stats,
  shown,
  total,
  problems,
  onProblems,
  pending,
  kind,
  readOnly,
}: {
  /** 当前格：「E6 · DisplayName」 */
  cell: string
  header: { badge: string; tone?: 'accent' | 'warning'; text: string }
  stats: ReturnType<typeof selectionStats>
  /** 筛选后显示几行、一共几行数据 */
  shown: number
  total: number
  problems: number
  onProblems: () => void
  /** 没保存的改动（格子 + 行操作） */
  pending: number
  kind: string
  readOnly: boolean
}) {
  const statText = useMemo(() => {
    if (!stats) return ''
    if (stats.skipped) return t('选中 {n} 格', { n: fmt(stats.cells) })
    if (!stats.nums) return t('选中 {n} 格', { n: fmt(stats.cells) })
    return t('选中 {n} 格 · 数字 {k} 个 · 求和 {sum} · 平均 {avg} · 最小 {min} · 最大 {max}', {
      n: fmt(stats.cells),
      k: fmt(stats.nums),
      sum: fmt(stats.sum),
      avg: fmt(stats.sum / stats.nums),
      min: fmt(stats.min),
      max: fmt(stats.max),
    })
  }, [stats])
  return (
    <div
      role="status"
      aria-label={t('表格状态')}
      className="tb:flex tb:h-6 tb:shrink-0 tb:items-center tb:gap-3 tb:border-t tb:bg-panel tb:px-3 tb:text-caption tb:text-muted"
    >
      <span className="tb:shrink-0 tb:font-mono tb:text-fg">{cell || '—'}</span>
      <span className="tb:flex tb:min-w-0 tb:shrink tb:items-center tb:gap-1.5">
        <Badge tone={header.tone} className="tb:h-4 tb:px-1.5">
          {header.badge}
        </Badge>
        <span className="tb:truncate">{header.text}</span>
      </span>
      <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-center tb:tabular-nums" title={statText}>
        {statText}
      </span>
      {shown !== total && (
        <span className="tb:shrink-0 tb:text-accent-text tb:tabular-nums">
          {t('显示 {n} / {total} 行', { n: fmt(shown), total: fmt(total) })}
        </span>
      )}
      <button
        type="button"
        onClick={onProblems}
        className={cn(
          'tb:flex tb:shrink-0 tb:cursor-pointer tb:items-center tb:gap-1 tb:rounded-sm tb:px-1 tb:hover:bg-hover',
          problems ? 'tb:text-danger' : 'tb:text-success',
        )}
      >
        {problems ? <AlertTriangle className="tb:h-3 tb:w-3" /> : <CheckCircle2 className="tb:h-3 tb:w-3" />}
        {problems ? t('{n} 处不合规', { n: problems }) : t('全部合规')}
      </button>
      {pending > 0 && <span className="tb:shrink-0 tb:text-accent-text">{t('{n} 处没保存', { n: pending })}</span>}
      <span className="tb:flex tb:shrink-0 tb:items-center tb:gap-1 tb:font-mono tb:uppercase">
        {readOnly && <Lock className="tb:h-3 tb:w-3" aria-label={t('只读')} />}
        {kind}
      </span>
    </div>
  )
}
