import { getAt, insert, placeOf, type GtPath, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { openMenu, type MenuItem } from '../../../menu.tsx'
import { blockUi, insertItems, type InsertItem } from '../gt-blocks/index.ts'

/** 插入菜单：插入项按组排（组名在表里第一次出现的顺序），组名当小标题，右边是 / 短名 */
/** skip：调用方自己另外放了的插入项 id（画布右键菜单把「子图」放在最上面） */
export function insertMenuItems(onPick: (it: InsertItem) => void, skip: string[] = []): MenuItem[] {
  const groups = new Map<string, InsertItem[]>()
  for (const it of insertItems()) {
    if (skip.includes(it.id)) continue
    const g = it.group()
    groups.set(g, [...(groups.get(g) ?? []), it])
  }
  const out: MenuItem[] = []
  for (const [g, list] of groups) {
    out.push({ title: g })
    for (const it of list)
      out.push({ label: it.label(), icon: blockUi(it.action).icon, hint: `/${it.slash}`, onClick: () => onPick(it) })
  }
  return out
}

/** 菜单从元素下沿弹出（键盘打开时没有鼠标位置） */
export function openInsertAt(el: Element | null, onPick: (it: InsertItem) => void) {
  const r = el?.getBoundingClientRect()
  const e = new MouseEvent('contextmenu', { clientX: r ? r.left + 40 : 200, clientY: r ? r.bottom : 200 })
  openMenu(e, insertMenuItems(onPick))
}

/** 新步骤插在哪：选中一步时插在它后面；没选时接在主流程末尾 */
export function insertPlace(doc: GtScript, at: GtPath | undefined): { slot: GtPath; index: number } {
  const place = at && placeOf(doc, at)
  if (place) return { slot: place.slot, index: place.index + 1 }
  return { slot: ['steps'], index: ((getAt(doc, ['steps']) as unknown[] | undefined) ?? []).length }
}

export const insertStep = (doc: GtScript, slot: GtPath, index: number, step: GtStep) => insert(doc, slot, index, [step])
