import { ListTree } from 'lucide-react'
import { CompTree, type Comp } from '../../../CompTree.tsx'
import { t } from '../../../host.ts'
import { Card } from '../../../ui.tsx'

/**
 * 组件树（效果图 A1 左上）：最上面一行是 Actor 自身（点了右栏看类默认值，和页头「类默认值」联动），
 * 下面 C++ 和蓝图加的组件按挂接关系缩进，父蓝图加的标「父蓝图」。读不到时说明原因
 */
export function CompPanel({
  name,
  items,
  online,
  selected,
  onSelect,
}: {
  name: string
  /** undefined 读取中，null 读不到（UE 没连上时） */
  items: Comp[] | null | undefined
  online: boolean
  selected: string
  onSelect: (path: string) => void
}) {
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <ListTree className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('组件')}
        </>
      }
      aside={items ? <span>{items.length}</span> : undefined}
      bodyClass="ue:overflow-auto"
    >
      {items ? (
        <CompTree actor={name} items={items} selected={selected} onSelect={onSelect} />
      ) : (
        <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
          {items === undefined
            ? t('读取中…')
            : online
              ? t('读不到组件')
              : t('UE 没连上：组件树要 UE 导出，打开编辑器后自动刷新')}
        </p>
      )}
    </Card>
  )
}
