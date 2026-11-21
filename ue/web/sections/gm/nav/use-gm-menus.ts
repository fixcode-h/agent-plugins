import { ArrowDown, ArrowUp, Check, Package, Pencil, Plus, Star, StarOff, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { hasFav, toggleFav } from '../../../../shared/gm/favs.ts'
import { placeOf } from '../../../../shared/gm/modules.ts'
import type { GmCat } from '../../../../shared/gm/schema.ts'
import type { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'
import { openMenu, type MenuItem } from '../../../menu.tsx'
import type { GmEntry } from '../data.ts'
import type { GmData } from '../use-gm.ts'
import { modsOf } from './GmNav.tsx'
import { addModule, deleteModule, moveToModule, renameModule, shiftModule } from './module-ops.ts'

type Ask = ReturnType<typeof useAsk>[1]

/**
 * 左栏的右键菜单和模块操作（规格第 6 节）：模块 改名 / 删除（只能删空的）/ 上移 / 下移；GM 移到模块… / 收藏；宏 收藏 / 删除。
 * 都是改 gm.json 再整份存回去（服务端校验后推 gm 事件，别的窗口跟着刷新）
 */
export function useGmMenus(d: GmData, ask: Ask, onMacroDeleted: (id: string) => void) {
  const { toast } = h()
  const newModule = async () => {
    const name = (
      await ask({ title: t('新建模块'), label: t('模块的名字（例如：背包、任务、战斗）'), init: '' })
    )?.trim()
    if (!name) return undefined
    if (modsOf(d).some((m) => m.name === name)) {
      toast.error(t('已经有叫「{n}」的模块了', { n: name }))
      return undefined
    }
    const r = addModule(d.gm, name)
    await d.saveGm(r.g)
    return { id: r.id, g: r.g }
  }

  const onModuleMenu = (e: MouseEvent, id: string, count: number) => {
    const mods = modsOf(d)
    const i = mods.findIndex((m) => m.id === id)
    const m = mods[i]
    if (!m) return
    openMenu(e, [
      {
        label: t('改名'),
        icon: Pencil,
        onClick: async () => {
          const name = (await ask({ title: t('模块改名'), label: t('模块的名字'), init: m.name }))?.trim()
          if (name && name !== m.name) await d.saveGm(renameModule(d.gm, mods, id, name))
        },
      },
      {
        label: t('上移'),
        icon: ArrowUp,
        disabled: i === 0,
        onClick: () => void d.saveGm(shiftModule(d.gm, mods, id, -1)),
      },
      {
        label: t('下移'),
        icon: ArrowDown,
        disabled: i === mods.length - 1,
        onClick: () => void d.saveGm(shiftModule(d.gm, mods, id, 1)),
      },
      'sep',
      {
        label: count ? t('删除（先把 {n} 条 GM 移走）', { n: count }) : t('删除模块'),
        icon: Trash2,
        danger: true,
        disabled: count > 0 || !!m.auto,
        onClick: () => void d.saveGm(deleteModule(d.gm, id)),
      },
    ])
  }

  /** GM 的右键：移到哪个模块（扫描出来的和自定义的都行，引擎分类没有模块）、收藏 */
  const onGmMenu = (e: MouseEvent, entry: GmEntry) => {
    const cat: GmCat = entry.src === 'engine' || entry.src === 'console' ? 'engine' : 'gm'
    const fav = hasFav(d.gm, cat, { key: entry.key })
    const items: MenuItem[] = []
    if (cat === 'gm') {
      const cur = entry.custom ? entry.custom.module : placeOf(entry.key, entry.group, d.gm).module
      const move = (id: string) => void d.saveGm(moveToModule(d.gm, entry.key, id))
      items.push(
        { title: t('移到模块') },
        ...modsOf(d).map((m) => ({
          label: m.name,
          icon: m.id === cur ? Check : Package,
          checked: m.id === cur,
          disabled: m.id === cur,
          onClick: () => move(m.id),
        })),
        {
          label: t('新建模块…'),
          icon: Plus,
          onClick: async () => {
            const r = await newModule()
            if (r) await d.saveGm(moveToModule(r.g, entry.key, r.id))
          },
        },
        'sep',
      )
    }
    items.push({
      label: fav ? t('取消收藏') : t('收藏'),
      icon: fav ? StarOff : Star,
      onClick: () => void d.saveGm(toggleFav(d.gm, cat, { key: entry.key })),
    })
    openMenu(e, items)
  }

  const onMacroMenu = (e: MouseEvent, id: string) => {
    const m = d.gm.macros.find((x) => x.id === id)
    if (!m) return
    const fav = hasFav(d.gm, 'macro', { key: `macro:${id}` })
    openMenu(e, [
      {
        label: fav ? t('取消收藏') : t('收藏'),
        icon: fav ? StarOff : Star,
        onClick: () => void d.saveGm(toggleFav(d.gm, 'macro', { key: `macro:${id}` })),
      },
      'sep',
      {
        label: t('删除宏'),
        icon: Trash2,
        danger: true,
        onClick: async () => {
          if (
            (await ask({ title: t('删除宏「{n}」？', { n: m.name }), okText: t('删除'), danger: true })) === undefined
          )
            return
          await d.saveGm({
            ...d.gm,
            macros: d.gm.macros.filter((x) => x.id !== id),
            favs: { ...d.gm.favs, macro: d.gm.favs.macro.filter((f) => f.key !== `macro:${id}`) },
          })
          onMacroDeleted(id)
        },
      },
    ])
  }

  return { newModule, onModuleMenu, onGmMenu, onMacroMenu }
}
