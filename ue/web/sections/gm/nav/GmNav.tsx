import { Crosshair, FileCode, ListVideo, Plus, SquareTerminal, Wand2, type LucideIcon } from 'lucide-react'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { argsText, moveFav, toggleFav } from '../../../../shared/gm/favs.ts'
import { placeOf } from '../../../../shared/gm/modules.ts'
import type { GmCat, GmFav } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { TreeList, type TreeLine } from '../../../TreeList.tsx'
import { SearchBox } from '../../../ui.tsx'
import { AgentBadge } from '../custom/ObjRule.tsx'
import { search, type GmEntry } from '../data.ts'
import { ObjList } from '../objcall/ObjList.tsx'
import type { ObjCallState } from '../objcall/use-objcall-state.tsx'
import type { GmData } from '../use-gm.ts'
import { FavPane, type FavRow } from './FavPane.tsx'
import { groupLines } from './group-lines.ts'
import { useLocalPref } from './local.ts'
import { allModules, type Mods } from './module-ops.ts'
import { moduleLines } from './module-lines.ts'

/** 右边选中的是什么：一条 GM（带从收藏、最近执行点进来的那组参数）或一个宏 */
export type GmPick = { kind: 'gm'; key: string; args?: GmFav['args'] } | { kind: 'macro'; id: string }

/** 每个分类里的来源筛选：GM 分 Lua / C++ / 自定义，引擎分 GM / 控制台命令 */
export type SrcFilter = 'all' | 'lua' | 'cpp' | 'custom' | 'engine' | 'console'

const inCat = (e: GmEntry, cat: GmCat) =>
  cat === 'gm'
    ? e.src === 'lua' || e.src === 'cpp' || e.src === 'custom'
    : cat === 'engine' && (e.src === 'engine' || e.src === 'console')

const ICON: Record<GmEntry['src'], LucideIcon> = {
  lua: FileCode,
  cpp: Wand2,
  engine: Wand2,
  custom: Crosshair,
  console: SquareTerminal,
}

/** 这个分类的模块（GM 分类才有）：存的在前，分组第一段自动算的在后 */
export function modsOf(d: GmData): Mods {
  const gms = d.entries.filter((e) => inCat(e, 'gm') && !e.custom)
  return allModules(
    d.gm,
    gms.map((e) => placeOf(e.key, e.group, d.gm).module),
  )
}

export interface GmNavProps {
  d: GmData
  cat: GmCat
  onCat: (c: GmCat) => void
  q: string
  onQ: (q: string) => void
  src: SrcFilter
  onSrc: (s: SrcFilter) => void
  pick?: GmPick
  onPick: (p: GmPick) => void
  onNewMacro: () => void
  onNewModule: () => void
  onGmMenu: (e: MouseEvent, entry: GmEntry) => void
  onModuleMenu: (e: MouseEvent, id: string, count: number) => void
  onMacroMenu: (e: MouseEvent, id: string) => void
  /** 对象调用分类的对象列表（GameTest 没装时不给，显示提示） */
  objList?: ObjCallState['listProps']
  footer?: ReactNode
}

/**
 * GM 页左栏（规格第 6 节、效果图 1）：顶上分类（GM · 引擎 · 宏 · 对象调用，带条数，切换记在本机）；下面当前分类里搜索和来源筛选；
 * 中间是 GM 的模块树 / 引擎的分组树 / 宏列表 / 对象列表；最下面这个分类的收藏，能折起来、高度能拖
 */
export function GmNav(p: GmNavProps) {
  const { ui } = h()
  const { d, cat, q } = p
  const [openList, setOpenList] = useKept<string[]>('gm-nav-open', [])
  const open = useMemo(() => new Set(openList), [openList])
  const toggle = (id: string) => setOpenList((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const [favOpen, setFavOpen] = useLocalPref<Partial<Record<GmCat, boolean>>>('favs-open', {})
  const byKey = useMemo(() => new Map(d.entries.map((e) => [e.key, e])), [d.entries])
  const inThis = useMemo(() => d.entries.filter((e) => inCat(e, cat)), [d.entries, cat])
  const count = (s: SrcFilter) => (s === 'all' ? inThis.length : inThis.filter((e) => e.src === s).length)
  const srcOpts: SrcFilter[] =
    cat === 'gm' ? ['all', 'lua', 'cpp', 'custom'] : cat === 'engine' ? ['all', 'engine', 'console'] : []
  // 引擎分类里两种都有时才给筛选（只有一种时筛选没意义）
  const showSrc = cat === 'gm' || (cat === 'engine' && count('engine') > 0 && count('console') > 0)
  const src = srcOpts.includes(p.src) ? p.src : 'all'
  const shown = useMemo(() => (src === 'all' ? inThis : inThis.filter((e) => e.src === src)), [inThis, src])
  const hits = useMemo(() => (q ? new Set(search(shown, q).map((e) => e.key)) : undefined), [shown, q])
  const selected = p.pick?.kind === 'gm' ? `gm:${p.pick.key}` : p.pick?.kind === 'macro' ? `macro:${p.pick.id}` : ''
  const mods = useMemo(() => modsOf(d), [d])
  const pickEntry = (e: GmEntry) => p.onPick({ kind: 'gm', key: e.key })

  const lines = useMemo<TreeLine[]>(() => {
    if (cat === 'gm')
      return moduleLines({
        entries: shown,
        gm: d.gm,
        mods,
        hits,
        open,
        toggle,
        selected,
        onPick: pickEntry,
        onGmMenu: p.onGmMenu,
        onModuleMenu: p.onModuleMenu,
        agentBadge: () => <AgentBadge />,
      })
    if (cat === 'engine')
      return groupLines({ entries: shown, hits, open, toggle, selected, onPick: pickEntry, onGmMenu: p.onGmMenu })
    if (cat === 'macro') {
      const k = q.trim().toLowerCase()
      return d.gm.macros
        .filter((m) => !k || m.name.toLowerCase().includes(k))
        .map((m) => ({
          key: `macro:${m.id}`,
          depth: 0,
          icon: ListVideo,
          label: m.name,
          expandable: false,
          open: false,
          selected: selected === `macro:${m.id}`,
          aside: t('{n} 步', { n: m.steps.length }),
          onSelect: () => p.onPick({ kind: 'macro', id: m.id }),
          onMenu: (ev: MouseEvent) => p.onMacroMenu(ev, m.id),
        }))
    }
    return []
    // 回调每次渲染都是新函数；行跟着数据、搜索、展开和选中变就够了
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, shown, d.gm, mods, hits, open, selected, q])

  const favRows = (): FavRow[] =>
    d.gm.favs[cat].map((f) => {
      if (cat === 'macro') {
        const m = d.gm.macros.find((x) => `macro:${x.id}` === f.key)
        return {
          key: f.key,
          icon: ListVideo,
          label: m?.name ?? f.key.slice(6),
          gone: !m,
          selected: !!m && selected === f.key,
          onClick: () => m && p.onPick({ kind: 'macro', id: m.id }),
        }
      }
      if (cat === 'objcall') {
        const name = f.key.slice(4)
        const has = d.gm.objects.some((o) => o.name === name)
        return {
          key: f.key,
          icon: Crosshair,
          label: name,
          gone: !has,
          selected: p.objList?.selected === name,
          onClick: () => p.objList?.onPick(name),
        }
      }
      const e = byKey.get(f.key)
      const a = argsText(f.args)
      return {
        key: f.key,
        icon: e ? ICON[e.src] : Wand2,
        label: (
          <>
            <span className={e?.src === 'custom' ? undefined : 'ue:font-mono'}>
              {e?.name ?? f.key.replace(/^[a-z]+:/, '')}
            </span>
            {a && <span className="ue:ml-1 ue:font-mono ue:text-muted">{a}</span>}
          </>
        ),
        title: [e?.name, a, e?.desc].filter(Boolean).join('\n'),
        // 控制台命令不在列表里（只列收藏和最近用过的）也能执行：只有 GM 改名、删了才算不在
        gone: !e,
        selected:
          selected === `gm:${f.key}` &&
          JSON.stringify(f.args ?? null) === JSON.stringify((p.pick as { args?: unknown })?.args ?? null),
        onClick: () => p.onPick({ kind: 'gm', key: f.key, args: f.args }),
      }
    })

  const CATS: { id: GmCat; label: string; n: number }[] = [
    { id: 'gm', label: 'GM', n: d.entries.filter((e) => inCat(e, 'gm')).length },
    { id: 'engine', label: t('引擎'), n: d.entries.filter((e) => inCat(e, 'engine')).length },
    { id: 'macro', label: t('宏'), n: d.gm.macros.length },
    { id: 'objcall', label: t('对象调用'), n: d.gm.objects.length },
  ]
  const SRC_LABEL: Record<SrcFilter, string> = {
    all: t('全部'),
    lua: 'Lua',
    cpp: 'C++',
    custom: t('自定义'),
    engine: 'GM',
    console: t('控制台命令'),
  }
  const placeholder =
    cat === 'macro' ? t('宏的名字') : cat === 'objcall' ? t('对象名、类名') : t('GM 名字、说明、参数或分组')

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <ui.Segmented
          size="sm"
          label={t('分类')}
          value={cat}
          onChange={p.onCat}
          options={CATS.map((c) => ({ id: c.id, label: `${c.label} ${c.n}` }))}
        />
        {/* 换分类时 key 变了，搜索框跟着清成这个分类上次搜的 */}
        <SearchBox key={cat} initial={q} placeholder={placeholder} onSearch={p.onQ} allowEmpty live />
        {showSrc && srcOpts.length > 0 && (
          <ui.Segmented
            size="sm"
            label={t('来源')}
            value={src}
            onChange={p.onSrc}
            options={srcOpts.map((s) => ({ id: s, label: `${SRC_LABEL[s]} ${count(s)}` }))}
          />
        )}
      </div>
      {cat === 'gm' && (
        <div className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:gap-2 ue:px-3 ue:text-caption">
          <span className="ue:font-medium ue:text-muted">{t('模块')}</span>
          <span className="ue:truncate ue:text-subtle">{t('每条 GM 都放在一个模块下')}</span>
          <button
            type="button"
            title={t('新建模块')}
            onClick={p.onNewModule}
            className="ue:ml-auto ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
          >
            <Plus className="ue:h-3.5 ue:w-3.5" />
          </button>
        </div>
      )}
      {cat === 'macro' && (
        <div className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:gap-2 ue:px-3 ue:text-caption">
          <span className="ue:font-medium ue:text-muted">{t('宏 {n}', { n: d.gm.macros.length })}</span>
          <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={p.onNewMacro}>
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('新建宏')}
          </ui.Button>
        </div>
      )}
      {cat === 'objcall' ? (
        p.objList ? (
          <ObjList {...p.objList} q={q} />
        ) : (
          <p className="ue:flex-1 ue:p-4 ue:text-footnote ue:text-subtle">{t('对象调用要项目装了 GameTest')}</p>
        )
      ) : lines.length ? (
        <TreeList lines={lines} label={t('GM')} />
      ) : (
        <p className="ue:flex-1 ue:p-4 ue:text-footnote ue:text-subtle">
          {q
            ? t('没有含「{q}」的条目', { q })
            : cat === 'macro'
              ? t('还没有宏：点「新建宏」，或在 GM 详情里点「加到宏」')
              : cat === 'engine'
                ? t('UE 没在运行时列不出引擎 GM；控制台命令在收藏和用过后出现在这里')
                : t('这里没有 GM')}
        </p>
      )}
      <FavPane
        rows={favRows()}
        open={favOpen[cat] ?? true}
        onOpenChange={(o) => setFavOpen({ ...favOpen, [cat]: o })}
        onRemove={(i) => void d.saveGm(toggleFav(d.gm, cat, d.gm.favs[cat][i]))}
        onMove={(i, to) => void d.saveGm(moveFav(d.gm, cat, i, to))}
        empty={
          cat === 'objcall'
            ? t('右键对象「收藏」放到这里')
            : cat === 'macro'
              ? t('右键宏「收藏」放到这里')
              : t('在详情里点「收藏这组参数」放到这里')
        }
      />
      {p.footer}
    </div>
  )
}
