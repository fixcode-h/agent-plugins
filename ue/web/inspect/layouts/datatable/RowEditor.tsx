import { ChevronLeft, ChevronRight, Pencil, SquarePen } from 'lucide-react'
import { Details } from '../../../details/Details.tsx'
import { looksLikePath } from '../../../details/model.ts'
import type { OpenHow } from '../../../details/RefChip.tsx'
import { h, t } from '../../../host.ts'
import { Card, ErrorText } from '../../../ui.tsx'
import { useRow } from './use-row.ts'

/**
 * 行编辑器（效果图 B1 下半）：选中行的全部字段，用细节面板画（分类折叠、颜色 / 向量 / 资源引用控件、改过的有重置），
 * 改值写回 UE（未保存，资源页头保存）。标题行有改行名、上一行 / 下一行
 */
export function RowEditor({
  path,
  row,
  onStep,
  onRename,
  onOpen,
  onChanged,
  struct,
}: {
  path: string
  row: string
  onStep: (dir: 1 | -1) => void
  onRename: (row: string) => void
  onOpen: (path: string, via?: string, how?: OpenHow) => void
  onChanged: () => void
  struct?: string
}) {
  const { ui } = h()
  const openRef = (p: string, via?: string) => (looksLikePath(p) ? (how: OpenHow) => onOpen(p, via, how) : undefined)
  const r = useRow(path, row, openRef, onChanged, struct)
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <SquarePen className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('行编辑器')}
          {row && <span className="ue:truncate ue:font-mono ue:text-footnote ue:font-normal ue:text-muted">{row}</span>}
        </>
      }
      aside={
        row ? (
          <>
            <ui.Button size="sm" variant="ghost" onClick={() => onRename(row)}>
              <Pencil className="ue:h-3.5 ue:w-3.5" /> {t('重命名行')}
            </ui.Button>
            <ui.IconButton icon={ChevronLeft} label={t('上一行')} size="sm" onClick={() => onStep(-1)} />
            <ui.IconButton icon={ChevronRight} label={t('下一行')} size="sm" onClick={() => onStep(1)} />
          </>
        ) : undefined
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      {!row ? (
        <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('在上面的表格里点一行，在这里看和改它的全部字段')}</p>
      ) : r.error ? (
        <div className="ue:p-3">
          <ErrorText>{r.error}</ErrorText>
        </div>
      ) : (
        <Details key={`${path}|${row}`} props={r.props ?? []} api={r.api} loading={!r.props} />
      )}
    </Card>
  )
}
