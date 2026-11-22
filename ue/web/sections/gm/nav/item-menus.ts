import {
  Braces,
  Copy,
  FlaskConical,
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
import { argsText, inCommon, macroKey, toggleCommon } from '../../../../shared/gm/common.ts'
import { copyMacro, deleteMacro } from '../../../../shared/gm/item-ops.ts'
import { shareMacro } from '../../../../shared/gm/share.ts'
import type { GmFav, GmStore } from '../../../../shared/gm/schema.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '../../../menu.tsx'
import { refOfMacro, refOfRecent } from '../../uekit/gt-gm/gm-ref.ts'
import { addToTest } from '../../uekit/gt-gm/AddToTest.tsx'
import { overrides } from '../custom/run-custom.ts'
import type { GmEntry } from '../data.ts'
import type { RecentRun } from '../RecentRuns.tsx'
import { runMacro } from '../run.ts'
import { modsOf } from './GmNav.tsx'
import { catOf, type GmMenuCtx, type MenuList } from './use-gm-menus.ts'

/**
 * 宏、常用、最近执行的右键菜单（规格第 6 节）。宏：打开 / 执行 / 重命名 / 复制一份 / 加到常用 / 删除；
 * 常用：执行 / 打开（对象是在对象调用里打开 / 读取…），改分组和移出常用由常用树自己加；
 * 最近执行：再执行一次 / 填回参数 / 这组参数加到常用 / 复制命令，自定义 GM 的再加「存成 GM…」
 */
export function useItemMenus(ctx: GmMenuCtx, save: (g: GmStore) => Promise<void>) {
  const { d, ask } = ctx
  const { project, target } = useUe()
  const { toast } = h()
  const find = (key: string) => d.entries.find((e) => e.key === key)
  const macroWhy = d.inst ? '' : t('UE 没在运行：GM 要在运行中的编辑器或游戏里执行')

  /** 从菜单执行宏：结果只弹提示（每一步的输出在宏编辑页里执行才看得到），所以同时打开这个宏 */
  /** 执行宏；open=false 时不切到宏分类（快速执行栏里执行，留在原地） */
  const execMacro = async (id: string, open = true) => {
    const m = d.gm.macros.find((x) => x.id === id)
    if (!m) return
    if (open) ctx.open({ kind: 'macro', id }, 'macro')
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
  const execWith = (e: GmEntry, args: GmFav['args'], c = catOf(e)) => {
    ctx.open({ kind: 'gm', key: e.key, args }, c)
    ctx.run.exec(e, args)
  }

  const onMacroMenu = (e: MouseEvent, id: string) => {
    const m = d.gm.macros.find((x) => x.id === id)
    if (!m) return
    const fav = inCommon(d.gm, { key: macroKey(id) })
    openMenu(e, [
      { label: t('打开'), icon: FolderOpen, onClick: () => ctx.open({ kind: 'macro', id }, 'macro') },
      { label: t('执行'), icon: Play, disabled: !!macroWhy, onClick: () => void execMacro(id) },
      { label: t('加到测试…'), icon: FlaskConical, onClick: () => addToTest(refOfMacro(m)) },
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
        label: t('复制为 JSON'),
        icon: Braces,
        hint: t('带上它调的自定义 GM'),
        onClick: () => copyText(shareMacro(d.gm, id, modsOf(d)) ?? ''),
      },
      {
        label: fav ? t('移出常用') : t('加到常用'),
        icon: fav ? StarOff : Star,
        onClick: () => void save(toggleCommon(d.gm, { key: macroKey(id) })),
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

  /** 常用里一条的动作（常用树在后面接改分组、移出常用） */
  const favMenu = (f: GmFav): MenuList => {
    if (f.key.startsWith('macro:')) {
      const id = f.key.slice(6)
      return [
        { label: t('执行'), icon: Play, disabled: !!macroWhy, onClick: () => void execMacro(id) },
        { label: t('打开'), icon: FolderOpen, onClick: () => ctx.open({ kind: 'macro', id }, 'common') },
        { label: t('在宏里打开'), icon: FolderOpen, onClick: () => ctx.open({ kind: 'macro', id }, 'macro') },
      ]
    }
    if (f.key.startsWith('obj:')) {
      const name = f.key.slice(4)
      return [
        { label: t('在对象调用里打开'), icon: FolderOpen, onClick: () => ctx.objcall.call(name, 'call') },
        { label: t('读取…'), icon: ScanSearch, onClick: () => ctx.objcall.call(name, 'get') },
      ]
    }
    const e = find(f.key)
    if (!e) return []
    const a = argsText(f.args)
    return [
      { label: t('执行'), icon: Play, disabled: !!ctx.canRun(e), onClick: () => execWith(e, f.args, 'common') },
      {
        label: t('打开'),
        icon: FolderOpen,
        onClick: () => ctx.open({ kind: 'gm', key: e.key, args: f.args }, 'common'),
      },
      {
        label: t('在「{c}」里打开', { c: catOf(e) === 'engine' ? t('引擎命令') : 'GM' }),
        icon: FolderOpen,
        hint: a || undefined,
        onClick: () => ctx.open({ kind: 'gm', key: e.key, args: f.args }, catOf(e)),
      },
    ]
  }

  const onRecentMenu = (ev: MouseEvent, r: RecentRun) => {
    const { entry: e, run } = r
    // 找不到条目（UE 没连上时的 C++ GM、改名删掉的）：只能复制当时的命令
    if (!e) {
      if (run.code) openMenu(ev, [{ label: t('复制命令'), icon: Copy, onClick: () => copyText(run.code) }])
      return
    }
    const c = e.custom
    // 收藏存的是「改过的那几个」（自定义 GM）或按顺序的参数，和详情里「收藏这组参数」一样
    const fav: GmFav = {
      key: e.key,
      args: c ? overrides(c, { ...c.args, ...(Array.isArray(run.args) ? {} : run.args) }) : run.args,
    }
    const cat = catOf(e)
    const isFav = inCommon(d.gm, fav)
    openMenu(ev, [
      { label: t('再执行一次'), icon: Play, disabled: !!ctx.canRun(e), onClick: () => execWith(e, run.args) },
      {
        label: t('填回参数'),
        icon: RotateCcw,
        onClick: () => ctx.open({ kind: 'gm', key: e.key, args: run.args }, cat),
      },
      {
        label: isFav ? t('这组参数移出常用') : t('这组参数加到常用'),
        icon: isFav ? StarOff : Star,
        onClick: () => void save(toggleCommon(d.gm, fav)),
      },
      !c && !!run.code && { label: t('复制命令'), icon: Copy, onClick: () => copyText(run.code) },
      // 这一次（带当时的参数）接到某个测试脚本最后（G7）
      refOfRecent(run) && { label: t('加到测试…'), icon: FlaskConical, onClick: () => addToTest(refOfRecent(run)!) },
      c && !Array.isArray(run.args) && 'sep',
      c &&
        !Array.isArray(run.args) && {
          label: t('存成 GM…'),
          icon: Save,
          onClick: () => ctx.objcall.saveFrom(c, run.args as Record<string, unknown>),
        },
    ])
  }

  return { onMacroMenu, favMenu, onRecentMenu, execMacro }
}
