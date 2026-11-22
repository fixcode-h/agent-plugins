import { Wand2 } from 'lucide-react'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { deleteMacro } from '../../../shared/gm/item-ops.ts'
import { placeOf } from '../../../shared/gm/modules.ts'
import type { GmCat, GmCustom } from '../../../shared/gm/schema.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { NotInstalled } from '../uekit/NotInstalled.tsx'
import { CustomDetail } from './custom/CustomDetail.tsx'
import type { GmEntry, GmParam } from './data.ts'
import { GmDetail } from './GmDetail.tsx'
import { MacroPane } from './MacroPane.tsx'
import { modsOf, type GmPick } from './nav/GmNav.tsx'
import { ObjCall } from './objcall/ObjCall.tsx'
import type { ObjCallState } from './objcall/use-objcall-state.tsx'
import { useObjHits } from './objcall/use-objcall.ts'
import type { GmData } from './use-gm.ts'
import type { GmRunState } from './use-gm-run.ts'

const NEED_GT = () =>
  t('对象调用和自定义 GM 要用 GameTest（UEKit 里 UELink 的扩展插件，UE 5.4 起）。装好后要完整编译一次、重启编辑器。')

/**
 * GM 页右边上半（规格第 6、7 节）：对象调用分类是工作台；否则看左边选中的 —— 宏、自定义 GM、扫描出来的 GM（含引擎的、控制台命令）。
 * 对象调用和自定义 GM 都要 GameTest：没装时给装的入口（复用扩展页的 NotInstalled）
 */
export function GmMain(p: {
  d: GmData
  cat: GmCat
  pick?: GmPick
  entry?: GmEntry
  find: (key: string) => GmEntry | undefined
  run: GmRunState
  obj: ObjCallState
  gt: { installed: boolean; known: boolean; live: boolean }
  canRun: string
  toChat?: (text: string) => void
  onEditBinding: (entry: GmEntry, p: GmParam, current?: LuaGmBinding) => void
  onMacro: (e: GmEntry) => void
  onOpenObjCall: (c: GmCustom) => void
  onEditRule: (c: GmCustom) => void
  onPickNone: () => void
}) {
  const { d, entry, run } = p
  // 自定义 GM 的对象此刻命中几个（gt.watch 推送）；没选自定义 GM 时不订阅
  const c = entry?.custom
  const objs = c ? Object.entries(c.objects).map(([name, o]) => ({ name, o })) : []
  const { project } = useUe()
  const live = p.gt.live
  const ch = useObjHits(project.id, live && !!c, objs)

  /** 对象列表里同名对象的规则和这条 GM 的副本不一样：给「从对象列表同步」（B11） */
  const syncRule = (g: GmCustom) => {
    const mine = g.objects[g.obj]?.ref
    const listed = d.gm.objects.find((o) => o.name === g.obj)?.ref
    if (!mine || !listed || JSON.stringify(mine) === JSON.stringify(listed)) return undefined
    return () => {
      const objects = { ...g.objects, [g.obj]: { ...g.objects[g.obj], ref: listed } as GmCustom['objects'][string] }
      void d.saveGm({ ...d.gm, custom: d.gm.custom.map((x) => (x.id === g.id ? { ...x, objects } : x)) })
    }
  }

  if (p.cat === 'objcall') {
    if (p.gt.known && !p.gt.installed) return <NotInstalled name="GameTest" desc={NEED_GT()} />
    return <ObjCall s={p.obj} d={d} live={live} canRun={p.canRun} onEditBinding={p.onEditBinding} />
  }
  const pick = p.pick
  const macro = pick?.kind === 'macro' ? d.gm.macros.find((m) => m.id === pick.id) : undefined
  if (macro)
    return (
      <MacroPane
        macro={macro}
        find={p.find}
        onSave={(m) => d.saveGm({ ...d.gm, macros: d.gm.macros.map((x) => (x.id === m.id ? m : x)) })}
        onDelete={() => void d.saveGm(deleteMacro(d.gm, macro.id)).then(p.onPickNone)}
        canRun={p.canRun}
        toChat={p.toChat}
      />
    )
  if (c && entry) {
    if (p.gt.known && !p.gt.installed) return <NotInstalled name="GameTest" desc={NEED_GT()} />
    return (
      <CustomDetail
        c={c}
        moduleName={modsOf(d).find((m) => m.id === c.module)?.name ?? c.module}
        args={run.valuesOf(c)}
        onArg={(n, v) => run.setCustomArg(c, n, v)}
        onArgs={(a) => run.fill(entry, a)}
        hit={ch.hits[c.obj]}
        hits={ch.hits}
        live={live}
        running={run.running}
        canRun={p.canRun || (!live ? t('对象调用要 UE 在运行、项目装了 GameTest') : '')}
        out={run.coutOf(c)}
        history={d.recent.filter((r) => r.key === entry.key)}
        fav={run.isFav(entry)}
        onRun={() => run.exec(entry)}
        onFav={() => run.toggleFav(entry)}
        onMacro={() => p.onMacro(entry)}
        onEditRule={() => p.onEditRule(c)}
        onSyncRule={syncRule(c)}
        onOpenObjCall={() => p.onOpenObjCall(c)}
        toChat={p.toChat}
        gm={d.gm}
        config={d.lua.data?.config}
        onEditBinding={p.onEditBinding}
      />
    )
  }
  if (entry) {
    const mod = entry.src === 'lua' || entry.src === 'cpp' ? placeOf(entry.key, entry.group, d.gm).module : undefined
    return (
      <GmDetail
        entry={entry}
        moduleName={mod ? (modsOf(d).find((m) => m.id === mod)?.name ?? mod) : undefined}
        args={run.argsOf(entry)}
        onArg={(i, v) => run.setArg(entry, i, v)}
        onArgs={(a) => run.fill(entry, a)}
        config={d.lua.data?.config}
        gm={d.gm}
        onRun={() => run.exec(entry)}
        running={run.running}
        out={run.outOf(entry)}
        canRun={p.canRun}
        history={d.recent.filter((r) => r.key === entry.key)}
        fav={run.isFav(entry)}
        onFav={() => run.toggleFav(entry)}
        onMacro={() => p.onMacro(entry)}
        toChat={p.toChat}
        onEditBinding={(prm, current) => p.onEditBinding(entry, prm, current)}
      />
    )
  }
  return (
    <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:p-8 ue:text-center ue:text-footnote ue:text-subtle">
      <Wand2 className="ue:h-6 ue:w-6" />
      {p.cat === 'macro'
        ? t('在左边选一个宏，或新建一个')
        : p.cat === 'common'
          ? t('在左边选一条常用的；GM、宏、对象上右键「加到常用」就会放到这里')
          : t('在左边的树里选一条 GM，在这里填参数、执行')}
    </div>
  )
}
