import { CircleDot, Shield, type LucideIcon } from 'lucide-react'
import type { GtScript } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { blockUi, insertItems, type BlockTone, type InsertItem } from '../../gt-blocks/index.ts'
import { blankGuard } from '../../gt-guards/model.ts'

/**
 * 编辑页左栏「节点」格子的注册表：一格 = 一个名字 + 一组插入项（按 InsertItem 的 id 或按 group 选）。
 * 插入项本身由各块文件登记（gt-blocks/registry.ts），这里只决定怎么分格、怎么排，所以加了新块后：
 * 落进已有的 group 就自动出现在对应格子里的菜单；要单独成一格，在下面加一行 registerPaletteCell
 */
export interface PaletteCell {
  id: string
  label: () => string
  /** 按插入项 id 选（排在前面，按写的顺序） */
  ids?: string[]
  /** 按插入项的组选（和 InsertItem.group() 比，所以也写 t('…')） */
  groups?: () => string[]
  order: number
  /** 不给时用第一项的块图标、色调 */
  icon?: LucideIcon
  tone?: BlockTone
  /** 不是插步骤的格子（守护）：点了做这件事，不能拖 */
  run?: (ctx: PaletteCtx) => void
}

/** 特殊格子拿得到的东西 */
export interface PaletteCtx {
  doc: GtScript
  apply: (doc: GtScript) => void
  /** 取消选中（右栏回到脚本设置） */
  deselect: () => void
}

const cells: PaletteCell[] = []

export function registerPaletteCell(c: PaletteCell) {
  const i = cells.findIndex((x) => x.id === c.id)
  if (i >= 0) cells[i] = c
  else cells.push(c)
}

export const paletteCells = () => [...cells].sort((a, b) => a.order - b.order)

/** 这一格的插入项：先按 id，再按组，去重 */
export function cellItems(c: PaletteCell): InsertItem[] {
  const all = insertItems()
  const out: InsertItem[] = []
  for (const id of c.ids ?? []) {
    const it = all.find((x) => x.id === id)
    if (it && !out.includes(it)) out.push(it)
  }
  const groups = c.groups?.() ?? []
  for (const it of all) if (groups.includes(it.group()) && !out.includes(it)) out.push(it)
  return out
}

export function cellLook(c: PaletteCell): { icon: LucideIcon; tone: BlockTone } {
  const first = cellItems(c)[0]
  const ui = first ? blockUi(first.action) : undefined
  return { icon: c.icon ?? ui?.icon ?? CircleDot, tone: c.tone ?? ui?.tone ?? 'subtle' }
}

/** 搜索：格子名、它的插入项的名字 / 短名 / 说明，有一个对上就留着 */
export function cellMatches(c: PaletteCell, q: string) {
  if (!q) return true
  const hay = [c.label(), ...cellItems(c).flatMap((it) => [it.label(), it.slash, it.hint?.() ?? ''])]
  return hay.some((s) => s.toLowerCase().includes(q))
}

/** 图标的浅色调底（Tailwind 要写全的类名才会生成） */
export const TONE_SOFT: Record<BlockTone, string> = {
  accent: 'ue:bg-accent/10',
  warning: 'ue:bg-warning/12',
  success: 'ue:bg-success/12',
  run: 'ue:bg-run/10',
  danger: 'ue:bg-danger/10',
  subtle: 'ue:bg-subtle/12',
}

// ---------- 内置的格子（效果图 1 的顺序：两列，从左到右、从上到下） ----------

registerPaletteCell({ id: 'step', label: () => t('一步操作'), groups: () => [t('一步操作'), t('界面')], order: 10 })
// 子图：不挂脚本的段和挂了脚本的调用合成一格（用户 2026-11-19），挂哪个脚本在检查器里选，也可以从脚本库直接拖进来
registerPaletteCell({ id: 'group', label: () => t('子图'), ids: ['group'], order: 20 })
registerPaletteCell({ id: 'if', label: () => t('如果'), groups: () => [t('分支')], order: 40 })
registerPaletteCell({ id: 'loop', label: () => t('循环'), groups: () => [t('循环')], order: 50 })
registerPaletteCell({ id: 'wait', label: () => t('等到'), ids: ['wait-cond', 'wait-ms'], order: 60 })
registerPaletteCell({ id: 'assert', label: () => t('检查'), ids: ['assert'], order: 70 })
registerPaletteCell({ id: 'set', label: () => t('设变量'), groups: () => [t('数据')], order: 80 })
registerPaletteCell({ id: 'invoke', label: () => t('调函数'), ids: ['invoke'], groups: () => [t('调用')], order: 90 })
registerPaletteCell({
  id: 'guard',
  label: () => t('守护'),
  order: 100,
  icon: Shield,
  tone: 'success',
  // 守护不是步骤，挂在脚本上：加一条空的，再取消选中让右栏显示脚本设置（守护在那里编辑）
  run: ({ doc, apply, deselect }) => {
    const list = Array.isArray(doc.guards) ? doc.guards : []
    const used = new Set(list.map((g) => String(g.id ?? '')))
    apply({ ...doc, guards: [...list, blankGuard(used)] })
    deselect()
  },
})
registerPaletteCell({ id: 'end', label: () => t('结束 / 失败'), groups: () => [t('结束 / 失败')], order: 110 })
