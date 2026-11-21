import {
  Copy,
  CopyPlus,
  FolderOpen,
  Pencil,
  Play,
  RotateCcw,
  Save,
  ScanSearch,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { argsText, hasFav, toggleFav } from '../../../../shared/gm/favs.ts'
import { copyMacro, deleteMacro } from '../../../../shared/gm/item-ops.ts'
import type { GmCat, GmFav, GmStore } from '../../../../shared/gm/schema.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '../../../menu.tsx'
import { overrides } from '../custom/run-custom.ts'
import type { GmEntry } from '../data.ts'
import type { RecentRun } from '../RecentRuns.tsx'
import { runMacro } from '../run.ts'
import { catOf, type GmMenuCtx, type MenuList } from './use-gm-menus.ts'

/**
 * 宏、收藏、最近执行的右键菜单（规格第 6 节）。宏：打开 / 执行 / 重命名 / 复制一份 / 收藏 / 删除；
 * 收藏：执行 / 打开 / 填回参数（对象收藏是调函数 / 取对象），取消收藏和上下移由 FavPane 自己加；
 * 最近执行：再执行一次 / 填回参数 / 收藏这组参数 / 复制命令，自定义 GM 的再加「存成 GM…」
 */
export function useItemMenus(ctx: GmMenuCtx, save: (g: GmStore) => Promise<void>) {
  const { d, ask } = ctx
  const { project, target } = useUe()
  const { toast } = h()
  const find = (key: string) => d.entries.find((e) => e.key === key)
  const macroWhy = d.inst ? '' : t('UE 没在运行：GM 要在运行中的编辑器或游戏里执行')

  /** 从菜单执行宏：结果只弹提示（每一步的输出在宏编辑页里执行才看得到），所以同时打开这个宏 */
  const execMacro = async (id: string) => {
    const m = d.gm.macros.find((x) => x.id === id)
    if (!m) return
    ctx.open({ kind: 'macro', id }, 'macro')
    try {
      const r = await runMacro(project.id, id, target)
      if (r.ok) toast.success(t('宏「{n}」执行完了（{k} 步）', { n: m.name, k: r.steps.length }))
      else {
        const bad = r.steps.find((s) => !s.ok)
        toast.error(t('宏「{n}」第 {k} 步失败：{e}', { n: m.name, k: r.failedAt ?? 0, e: bad?.error ?? '' }))
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  /** 带着一组参数执行：选中这条（参数填回去，输出显示在详情里）再执行 */
  const execWith = (e: GmEntry, args: GmFav['args']) => {
    ctx.open({ kind: 'gm', key: e.key, args }, catOf(e))
    ctx.run.exec(e, args)
  }

  const onMacroMenu = (e: MouseEvent, id: string) => {
    const m = d.gm.macros.find((x) => x.id === id)
    if (!m) return
    const fav = hasFav(d.gm, 'macro', { key: `macro:${id}` })
    openMenu(e, [
      { label: t('打开'), icon: FolderOpen, onClick: () => ctx.open({ kind: 'macro', id }, 'macro') },
      { label: t('执行'), icon: Play, disabled: !!macroWhy, onClick: () => void execMacro(id) },
      'sep',
      {
        label: t('重命名'),
        icon: Pencil,
        onClick: async () => {
          const name = (await ask({ title: t('宏改名'), label: t('宏的名字'), init: m.name }))?.trim()
          if (name && name !== m.name)
            await save({ ...d.gm, macros: d.gm.macros.map((x) => (x.id === id ? { ...x, name } : x)) })
        },
      },
      {
        label: t('复制一份'),
        icon: CopyPlus,
        onClick: async () => {
          const r = copyMacro(d.gm, id)
          if (!r) return
          await save(r.g)
          ctx.open({ kind: 'macro', id: r.id }, 'macro')
        },
      },
      {
        label: fav ? t('取消收藏') : t('收藏'),
        icon: fav ? StarOff : Star,
        onClick: () => void save(toggleFav(d.gm, 'macro', { key: `macro:${id}` })),
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
          await save(deleteMacro(d.gm, id))
          ctx.onMacroDeleted(id)
        },
      },
    ])
  }

  /** 收藏一条的动作（FavPane 在后面接取消收藏、上移、下移） */
  const favMenu = (cat: GmCat, f: GmFav): MenuList => {
    if (cat === 'macro') {
      const id = f.key.slice(6)
      return [
        { label: t('执行'), icon: Play, disabled: !!macroWhy, onClick: () => void execMacro(id) },
        { label: t('打开'), icon: FolderOpen, onClick: () => ctx.open({ kind: 'macro', id }, 'macro') },
      ]
    }
    if (cat === 'objcall') {
      const name = f.key.slice(4)
      return [
        { label: t('调函数'), icon: Play, onClick: () => ctx.objcall.call(name, 'call') },
        { label: t('取对象'), icon: ScanSearch, onClick: () => ctx.objcall.call(name, 'get') },
      ]
    }
    const e = find(f.key)
    if (!e) return []
    const a = argsText(f.args)
    return [
      { label: t('执行'), icon: Play, disabled: !!ctx.canRun(e), onClick: () => execWith(e, f.args) },
      { label: t('打开'), icon: FolderOpen, onClick: () => ctx.open({ kind: 'gm', key: e.key }, cat) },
      !!a && {
        label: t('填回参数'),
        icon: RotateCcw,
        hint: a,
        onClick: () => ctx.open({ kind: 'gm', key: e.key, args: f.args }, cat),
      },
    ]
  }

  const onRecentMenu = (ev: MouseEvent, r: RecentRun) => {
    const { entry: e, run } = r
    const c = e.custom
    // 收藏存的是「改过的那几个」（自定义 GM）或按顺序的参数，和详情里「收藏这组参数」一样
    const fav: GmFav = {
      key: e.key,
      args: c ? overrides(c, { ...c.args, ...(Array.isArray(run.args) ? {} : run.args) }) : run.args,
    }
    const cat = catOf(e)
    const isFav = hasFav(d.gm, cat, fav)
    openMenu(ev, [
      { label: t('再执行一次'), icon: Play, disabled: !!ctx.canRun(e), onClick: () => execWith(e, run.args) },
      {
        label: t('填回参数'),
        icon: RotateCcw,
        onClick: () => ctx.open({ kind: 'gm', key: e.key, args: run.args }, cat),
      },
      {
        label: isFav ? t('取消收藏这组参数') : t('收藏这组参数'),
        icon: isFav ? StarOff : Star,
        onClick: () => void save(toggleFav(d.gm, cat, fav)),
      },
      !c && !!run.code && { label: t('复制命令'), icon: Copy, onClick: () => copyText(run.code) },
      c && !Array.isArray(run.args) && 'sep',
      c &&
        !Array.isArray(run.args) && {
          label: t('存成 GM…'),
          icon: Save,
          onClick: () => ctx.objcall.saveFrom(c, run.args as Record<string, unknown>),
        },
    ])
  }

  return { onMacroMenu, favMenu, onRecentMenu }
}
