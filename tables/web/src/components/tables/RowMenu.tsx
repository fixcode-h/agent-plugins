import { ArrowDown, ArrowUp } from 'lucide-react'
import { t } from '@shared/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MenuShortcut,
} from '@/components/ui/menu'

export interface RowMenuActions {
  /** 在 at 插 n 行；copy 是要复制的那一行 */
  insert: (at: number, n: number, copy?: number) => void
  /** 删掉这些行（行号从大到小） */
  remove: (rows: number[]) => void
  /** 选中的行上移 / 下移一行 */
  move: (dir: -1 | 1) => void
}

/**
 * 行号的右键菜单：右键点在选中的几行上时按这几行算（插几行、删几行、整体上移下移），
 * 点在别处时先选中那一行（use-grid-edit 的 onRowDown）
 */
export function RowMenu({
  trigger,
  ...rest
}: {
  r: number
  trigger: React.ReactElement
  /** 现在选中的行（按显示顺序）；不含 r 时只按 r 这一行算 */
  selected: number[] | null
  /** 有主键列：新插的行自动编号 */
  keyCol: boolean
  act: RowMenuActions
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent>
        <RowMenuItems {...rest} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 菜单打开时才算选中了几行（每个看得见的行号都挂一个菜单，选中整列时别每次渲染都扫一遍几万行） */
function RowMenuItems({
  r,
  selected,
  keyCol,
  act,
}: {
  r: number
  selected: number[] | null
  keyCol: boolean
  act: RowMenuActions
}) {
  const rows = selected?.includes(r) ? selected : [r]
  const n = rows.length
  let top = rows[0]
  let bottom = rows[0]
  for (const x of rows) {
    if (x < top) top = x
    if (x > bottom) bottom = x
  }
  return (
    <>
      <ContextMenuItem onSelect={() => act.insert(top, n)}>
        {n > 1 ? t('在上方插入 {n} 行', { n }) : t('在上方插入一行')}
        <MenuShortcut>Ctrl+Shift+=</MenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => act.insert(bottom + 1, n)}>
        {n > 1 ? t('在下方插入 {n} 行', { n }) : t('在下方插入一行')}
      </ContextMenuItem>
      {n === 1 && (
        <ContextMenuItem onSelect={() => act.insert(r + 1, 1, r)}>
          {keyCol ? t('复制这一行插到下方（主键自动编号）') : t('复制这一行插到下方')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => act.move(-1)}>
        <ArrowUp className="tb:h-3.5 tb:w-3.5 tb:text-subtle" />
        {n > 1 ? t('选中的 {n} 行上移一行', { n }) : t('上移一行')}
        <MenuShortcut>Alt+↑</MenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => act.move(1)}>
        <ArrowDown className="tb:h-3.5 tb:w-3.5 tb:text-subtle" />
        {n > 1 ? t('选中的 {n} 行下移一行', { n }) : t('下移一行')}
        <MenuShortcut>Alt+↓</MenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem danger onSelect={() => act.remove([...rows].sort((a, b) => b - a))}>
        {n > 1 ? t('删除选中的 {n} 行', { n }) : t('删除第 {n} 行', { n: r + 1 })}
        <MenuShortcut>Ctrl+-</MenuShortcut>
      </ContextMenuItem>
    </>
  )
}

/** 拖填充柄时鼠标右下方的小提示：最远那一格会填成什么（像 Excel），空值写「空」 */
export function FillTip({ tip }: { tip: { x: number; y: number; text: string } | null }) {
  if (!tip) return null
  return (
    <div
      role="status"
      className="tb:pointer-events-none tb:fixed tb:z-50 tb:max-w-60 tb:truncate tb:rounded-(--c-popover-radius) tb:border tb:bg-(--c-popover-bg) tb:px-2 tb:py-0.5 tb:font-mono tb:text-caption tb:shadow-md"
      style={{ left: tip.x + 14, top: tip.y + 16 }}
    >
      {tip.text || <span className="tb:text-subtle">{t('空')}</span>}
    </div>
  )
}
