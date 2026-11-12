import { useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableHit, TableSearch } from '@shared/tables'
import { colName } from '@/lib/sheet'
import { cn } from '@/lib/utils'
import { GroupHeader, ListGroup } from '@/components/layout/ListPane'

/** 每个文件最多列这么多处，再多的打开文件后用表格里的查找 */
const PER_FILE = 50

/**
 * 表格页左侧的内容搜索结果：按文件分组（组头吸顶、能折叠），每处命中一行「E6 · 字段名 · 那格的字」，命中的词高亮。
 * 点一行打开那个文件、切到那张表、滚到那一格；上下键在结果里移动，表格跟着定位
 */
export function TableHits({
  result,
  query,
  loading,
  error,
  onOpen,
}: {
  result: TableSearch | null
  query: string
  loading: boolean
  error?: string
  onOpen: (h: TableHit) => void
}) {
  const groups = useMemo(() => {
    const m = new Map<string, TableHit[]>()
    for (const h of result?.hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h])
    return [...m]
  }, [result])
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [cur, setCur] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  // 上下键走的是展开着的那些行
  const flat = useMemo(
    () => groups.flatMap(([path, hits]) => (folded.has(path) ? [] : hits.slice(0, PER_FILE))),
    [groups, folded],
  )
  const pick = (i: number) => {
    const h = flat[i]
    if (!h) return
    setCur(i)
    onOpen(h)
    // 打开表格会把焦点拿走：拿回来，接着按上下键
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-hit="${i}"]`)?.focus())
  }
  if (error) return <p className="tb:px-3 tb:py-4 tb:text-footnote tb:text-danger">{error}</p>
  if (!query.trim())
    return (
      <p className="tb:px-3 tb:py-6 tb:text-center tb:text-footnote tb:text-subtle">
        {t('输入要找的字，在所有表格的格子里找')}
      </p>
    )
  if (loading && !result)
    return (
      <div className="tb:flex tb:justify-center tb:p-6 tb:text-subtle">
        <Loader2 className="tb:h-4 tb:w-4 tb:animate-spin" />
      </div>
    )
  if (!groups.length)
    return (
      <p className="tb:px-3 tb:py-6 tb:text-center tb:text-footnote tb:text-subtle">
        {t('{n} 个表格里都没有「{q}」', { n: result?.files ?? 0, q: query })}
      </p>
    )
  return (
    <div
      ref={box}
      className="tb:flex tb:flex-col tb:gap-1"
      aria-busy={loading}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        pick(Math.max(0, Math.min(flat.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))))
      }}
    >
      <p className="tb:px-2 tb:pt-1 tb:text-caption tb:text-subtle">
        {t('{files} 个文件里找到 {n} 处', { files: groups.length, n: result!.hits.length })}
        {result?.truncated && t('（只列出前 {n} 处）', { n: result.hits.length })}
      </p>
      {groups.map(([path, hits]) => {
        const shut = folded.has(path)
        return (
          <ListGroup
            key={path}
            label={path}
            collapsed={shut}
            header={
              <div className="frost tb:sticky tb:top-0 tb:z-10">
                <GroupHeader
                  compact
                  label={<HitFile path={path} />}
                  count={hits.length}
                  collapsed={shut}
                  onToggle={() =>
                    setFolded((f) => {
                      const n = new Set(f)
                      if (n.has(path)) n.delete(path)
                      else n.add(path)
                      return n
                    })
                  }
                />
              </div>
            }
          >
            {hits.slice(0, PER_FILE).map((h, k) => {
              const i = flat.indexOf(h)
              return (
                <button
                  key={k}
                  type="button"
                  data-hit={i}
                  onClick={() => pick(i)}
                  className={cn(
                    'tb:flex tb:h-7 tb:w-full tb:cursor-pointer tb:items-center tb:gap-2 tb:rounded-(--c-row-radius) tb:px-2 tb:text-left tb:text-body tb:hover:bg-sel/60',
                    i === cur && 'tb:bg-sel',
                  )}
                >
                  <span className="tb:shrink-0 tb:font-mono tb:text-caption tb:text-subtle" title={h.sheet}>
                    {colName(h.col)}
                    {h.row + 1}
                  </span>
                  {h.field && (
                    <span
                      className="tb:max-w-[40%] tb:shrink-0 tb:truncate tb:font-mono tb:text-caption tb:text-muted"
                      title={h.field}
                    >
                      {h.field}
                    </span>
                  )}
                  <Mark text={h.text} q={query} />
                </button>
              )
            })}
            {hits.length > PER_FILE && (
              <p className="tb:px-2 tb:py-1 tb:text-caption tb:text-subtle">
                {t('还有 {n} 处，打开文件后用表格里的查找', { n: hits.length - PER_FILE })}
              </p>
            )}
          </ListGroup>
        )
      })}
    </div>
  )
}

function HitFile({ path }: { path: string }) {
  return (
    <span className="tb:flex tb:min-w-0 tb:items-center tb:gap-1.5" title={path}>
      <FileSpreadsheet className="tb:h-3.5 tb:w-3.5 tb:shrink-0" />
      <span className="tb:truncate">{path.slice(path.lastIndexOf('/') + 1)}</span>
    </span>
  )
}

/** 命中的词加底色 */
function Mark({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase())
  if (i < 0) return <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-muted">{text}</span>
  const n = q.trim().length
  // 命中在很后面时从前面截掉一段，让命中的词露出来
  const from = Math.max(0, i - 16)
  return (
    <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:text-muted">
      {from > 0 && '…'}
      {text.slice(from, i)}
      <mark className="tb:rounded-[3px] tb:bg-accent/20 tb:px-px tb:text-fg">{text.slice(i, i + n)}</mark>
      {text.slice(i + n)}
    </span>
  )
}
