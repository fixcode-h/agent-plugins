import {
  ArrowDown,
  Braces,
  ArrowUp,
  Copy,
  CopyPlus,
  Crosshair,
  FolderOpen,
  ListPlus,
  Package,
  Pencil,
  Play,
  Plus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { inCommon, toggleCommon } from '../../../../shared/gm/common.ts'
import { copyCustom, deleteCustom, macrosUsing, renameCustom } from '../../../../shared/gm/item-ops.ts'
import { materialize, placeOf } from '../../../../shared/gm/modules.ts'
import { shareCustom, shareModule } from '../../../../shared/gm/share.ts'
import type { GmCat, GmCustom, GmStore } from '../../../../shared/gm/schema.ts'
import type { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'
import { copyText, openMenu, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { cppLine, type GmEntry } from '../data.ts'
import { preview } from '../run.ts'
import type { GmRunState } from '../use-gm-run.ts'
import type { GmData } from '../use-gm.ts'
import type { GmPick } from './GmNav.tsx'
import { modsOf } from './GmNav.tsx'
import { useItemMenus } from './item-menus.ts'
import { addModule, deleteModule, moveToModule, renameModule, shiftModule } from './module-ops.ts'

type Ask = ReturnType<typeof useAsk>[1]
export type MenuList = (MenuItem | false | undefined | null | '')[]

/** 菜单要用到的页面上的东西：GmPage 建一份传进来（不靠闭包捕获整页状态） */
export interface GmMenuCtx {
  d: GmData
  ask: Ask
  run: GmRunState
  /** 这条 GM 现在执行不了的原因（UE 没开、自定义 GM 要 GameTest）；空串是能执行 */
  canRun: (e: GmEntry) => string
  /** 切到分类 c 并选中 p（带参数时把参数填回去）；从常用打开时 c 是 common */
  open: (p: GmPick, c: GmCat) => void
  addToMacro: (e: GmEntry) => void
  editRule: (c: GmCustom) => void
  /** 对象调用：选对象并切到调函数 / 取对象、在某个模块里新建 GM、把一组参数存成 GM */
  objcall: {
    call: (name: string, mode: 'call' | 'get') => void
    newIn: (moduleId: string) => void
    saveFrom: (c: GmCustom, args: Record<string, unknown>) => void
  }
  onMacroDeleted: (id: string) => void
  onCustomDeleted: (key: string) => void
}

export const catOf = (e: GmEntry): GmCat => (e.src === 'engine' || e.src === 'console' ? 'engine' : 'gm')

/** 「复制命令」：Lua 是调用代码，C++ / 引擎 GM 是控制台写法，控制台命令就是它自己 */
export function commandOf(e: GmEntry, args: string[]) {
  if (e.src === 'console') return e.name
  if (e.src === 'lua') return preview(e, args).code || e.name
  return cppLine(e.name, args)
}

/**
 * 左栏的右键菜单和模块操作（规格第 6 节）：模块 改名 / 上移 / 下移 / 删除（只能删空的）/ 在这个模块里新建 GM；
 * GM 打开 / 执行 / 加到宏 / 复制命令 / 移到模块… / 加到常用，自定义 GM 再加改匹配规则、重命名、复制一份、删除。
 * 宏、常用、最近执行的菜单在 item-menus.ts。都是改 gm.json 再整份存回去（服务端校验后推 gm 事件，别的窗口跟着刷新）
 */
export function useGmMenus(ctx: GmMenuCtx) {
  const { d, ask } = ctx
  const { toast } = h()
  const save = async (g: GmStore) => {
    try {
      await d.saveGm(g)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
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
        label: t('在这个模块里新建 GM'),
        icon: Crosshair,
        hint: t('对象调用'),
        onClick: async () => {
          // 自动算出来的模块还没写进 gm.json：先写进去，保存为 GM 的模块下拉里才有它
          if (m.auto) await save(materialize(d.gm, mods))
          ctx.objcall.newIn(id)
        },
      },
      {
        label: t('复制为 JSON'),
        icon: Braces,
        hint: t('带上里面的自定义 GM'),
        onClick: () => copyText(shareModule(d.gm, m)),
      },
      'sep',
      {
        label: t('改名'),
        icon: Pencil,
        onClick: async () => {
          const name = (await ask({ title: t('模块改名'), label: t('模块的名字'), init: m.name }))?.trim()
          if (name && name !== m.name) await save(renameModule(d.gm, mods, id, name))
        },
      },
      { label: t('上移'), icon: ArrowUp, disabled: i === 0, onClick: () => void save(shiftModule(d.gm, mods, id, -1)) },
      {
        label: t('下移'),
        icon: ArrowDown,
        disabled: i === mods.length - 1,
        onClick: () => void save(shiftModule(d.gm, mods, id, 1)),
      },
      'sep',
      {
        label: count ? t('删除（先把 {n} 条 GM 移走）', { n: count }) : t('删除模块'),
        icon: Trash2,
        danger: true,
        disabled: count > 0 || !!m.auto,
        onClick: () => void save(deleteModule(d.gm, id)),
      },
    ])
  }

  /** 「移到模块 ▸」：模块一多（几十个）平铺会占满一屏，收进子菜单，项多了自动带搜索 */
  const moveItem = (entry: GmEntry): MenuItem => {
    const cur = entry.custom ? entry.custom.module : placeOf(entry.key, entry.group, d.gm).module
    const mods = modsOf(d)
    return {
      label: t('移到模块'),
      icon: Package,
      hint: mods.find((m) => m.id === cur)?.name,
      search: t('搜模块'),
      sub: [
        {
          label: t('新建模块…'),
          icon: Plus,
          onClick: async () => {
            const r = await newModule()
            if (r) await save(moveToModule(r.g, entry.key, r.id))
          },
        },
        'sep',
        ...mods.map((m) => ({
          label: m.name,
          icon: Package,
          checked: m.id === cur,
          disabled: m.id === cur,
          onClick: () => void save(moveToModule(d.gm, entry.key, m.id)),
        })),
      ],
    }
  }

  /** 自定义 GM 自己的：改匹配规则（这条 GM 里的副本）、重命名、复制一份 */
  const customItems = (c: GmCustom): MenuList => [
    !!c.objects[c.obj]?.ref && { label: t('改匹配规则…'), icon: Crosshair, onClick: () => ctx.editRule(c) },
    {
      label: t('重命名'),
      icon: Pencil,
      onClick: async () => {
        const name = (await ask({ title: t('自定义 GM 改名'), label: t('GM 的名字'), init: c.name }))?.trim()
        if (name && name !== c.name) await save(renameCustom(d.gm, c.id, name))
      },
    },
    {
      label: t('复制一份'),
      icon: CopyPlus,
      onClick: async () => {
        const r = copyCustom(d.gm, c.id)
        if (!r) return
        await save(r.g)
        ctx.open({ kind: 'gm', key: `custom:${r.id}` }, 'gm')
      },
    },
    { label: t('复制为 JSON'), icon: Braces, onClick: () => copyText(shareCustom(d.gm, c.id, modsOf(d)) ?? '') },
  ]

  const deleteItem = (c: GmCustom): MenuItem => ({
    label: t('删除'),
    icon: Trash2,
    danger: true,
    onClick: async () => {
      const used = macrosUsing(d.gm, c.id).map((m) => `「${m.name}」`)
      const ok = await ask({
        title: t('删除自定义 GM「{n}」？', { n: c.name }),
        message: used.length
          ? t('宏 {m} 里有调它的步骤，这些步骤会一起删掉。', { m: used.join('、') })
          : t('删了收不回；常用里的这条也一起去掉。'),
        okText: t('删除'),
        danger: true,
      })
      if (ok === undefined) return
      await save(deleteCustom(d.gm, c.id))
      ctx.onCustomDeleted(`custom:${c.id}`)
    },
  })

  /** GM 的右键（GM 分类和引擎分类共用）：引擎分类没有模块，自定义 GM 多几项 */
  const onGmMenu = (e: MouseEvent, entry: GmEntry) => {
    const cat = catOf(entry)
    const fav = inCommon(d.gm, { key: entry.key })
    const why = ctx.canRun(entry)
    const pick: GmPick = { kind: 'gm', key: entry.key }
    openMenu(e, [
      { label: t('打开'), icon: FolderOpen, onClick: () => ctx.open(pick, cat) },
      {
        label: t('执行'),
        icon: Play,
        disabled: !!why,
        onClick: () => {
          ctx.open(pick, cat)
          ctx.run.exec(entry)
        },
      },
      { label: t('加到宏…'), icon: ListPlus, onClick: () => ctx.addToMacro(entry) },
      !entry.custom && {
        label: t('复制命令'),
        icon: Copy,
        onClick: () => copyText(commandOf(entry, ctx.run.argsOf(entry))),
      },
      'sep',
      ...(entry.custom ? customItems(entry.custom) : []),
      'sep',
      cat === 'gm' && moveItem(entry),
      {
        label: fav ? t('移出常用') : t('加到常用'),
        icon: fav ? StarOff : Star,
        onClick: () => void save(toggleCommon(d.gm, { key: entry.key })),
      },
      entry.custom && 'sep',
      entry.custom && deleteItem(entry.custom),
    ])
  }

  return { newModule, onModuleMenu, onGmMenu, ...useItemMenus(ctx, save) }
}
