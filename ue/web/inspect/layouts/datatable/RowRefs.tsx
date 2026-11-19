import { ArrowUpRight, Link2 } from 'lucide-react'
import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import type { OpenHow } from '../../../details/RefChip.tsx'
import { t } from '../../../host.ts'
import { Card, ErrorText, Note } from '../../../ui.tsx'

interface Refs {
  referencers?: { package: string; level: number }[]
  referencerTotal?: number
}

/**
 * 右下「引用」（效果图 B1 右下）：哪些资源引用了这张表（asset.refs，按包统计）。
 * 效果图要的是「引用这一行」（按 DataTableRowHandle 查到行），UELink 还没有按行查的接口，先按表列出并写明
 */
export function RowRefs({
  path,
  onOpen,
}: {
  path: string
  onOpen: (path: string, via?: string, how?: OpenHow) => void
}) {
  const { project } = useUe()
  const data = useLoad(
    () => op<Refs>(project.id, 'asset.refs', { path, direction: 'referencers', depth: 1, limit: 100 }),
    [project.id, path],
    0,
    `${project.id}/dt/refs/${path}`,
  )
  const items = data.data?.referencers ?? []
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <Link2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('引用这张表')}
        </>
      }
      aside={data.data ? <span>{data.data.referencerTotal ?? items.length}</span> : undefined}
      bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto"
    >
      <div className="ue:p-2">
        <Note tone="info">{t('按资源统计；改行名前先看这些资源里有没有按行名引用（行级引用要 UELink 新接口）')}</Note>
      </div>
      {data.error && (
        <div className="ue:px-3">
          <ErrorText>{data.error}</ErrorText>
        </div>
      )}
      {data.data && !items.length && (
        <p className="ue:px-4 ue:py-2 ue:text-footnote ue:text-subtle">{t('没有资源引用这张表')}</p>
      )}
      {items.map((r) => {
        const name = r.package.split('/').pop() ?? r.package
        return (
          <button
            key={r.package}
            type="button"
            onClick={(e) => onOpen(`${r.package}.${name}`, t('引用'), { ctrl: e.ctrlKey || e.metaKey })}
            className="ue:group ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:px-3 ue:text-left ue:text-footnote ue:hover:bg-hover"
          >
            <span className="ue:truncate ue:font-mono ue:text-fg">{name}</span>
            <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-caption ue:text-subtle">{r.package}</span>
            <ArrowUpRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle ue:group-hover:text-fg" />
          </button>
        )
      })}
    </Card>
  )
}
