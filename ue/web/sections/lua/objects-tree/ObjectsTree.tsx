import {
  Box,
  Braces,
  Component,
  CornerDownRight,
  FileCode2,
  Ghost,
  Globe,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { parseLuaPath } from '../../../../server/luapath.ts'
import { useUe } from '../../../ctx.tsx'
import { FilterButton } from '../../../FilterButton.tsx'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { Hit } from '../../../tree-search.tsx'
import { TreeList, type TreeLine } from '../../../TreeList.tsx'
import { ErrorText, SearchBox } from '../../../ui.tsx'
import type { LeakItem } from '../debug-types.ts'
import { StateDot, StateBadge, StateLegend, worldName } from './parts.tsx'
import type { LuaSel, TreeData } from './tree-data.ts'
import {
  filterState,
  groupObjects,
  idleModules,
  isClassObj,
  isPathQuery,
  search,
  stateOf,
  type Grouping,
  type StateFilter,
  type TNode,
} from './tree-model.ts'

/**
 * Lua 对象页左栏（设计稿 designs/Lua对象页重设计-设计稿.md 第四节）：全局、绑定对象、模块合在一棵树里分组显示；
 * 绑定对象按 Lua 类 / UE 类继承 / 归属成树；一个搜索框边打字边筛（类名含子类、对象名、模块、全局），
 * 带 . [ : 的按回车当 Lua 路径打开
 */
export function ObjectsTree({
  data,
  error,
  sel,
  leaks,
  onSelect,
  onReload,
  footer,
}: {
  data?: TreeData
  error?: string
  sel?: LuaSel
  leaks?: LeakItem[]
  onSelect: (s: LuaSel) => void
  onReload: () => void
  /** 树下面的东西（监视） */
  footer?: ReactNode
}) {
  const { project } = useUe()
  const { ui } = h()
  const kk = `${project.id}/lua`
  const [q, setQ] = useKept(`${kk}/treeQ`, '')
  const [grouping, setGrouping] = useKept<Grouping>(`${kk}/grouping`, 'module')
  const [filter, setFilter] = useKept<StateFilter>(`${kk}/stateFilter`, 'all')
  const [open, setOpen] = useKept<Record<string, boolean>>(`${kk}/treeOpen`, {})
  const [pathError, setPathError] = useKept(`${kk}/pathError`, '')

  const objs = filterState(data?.objs ?? [], filter)
  const isOpen = (key: string, def: boolean) => open[key] ?? def
  const toggle = (key: string, def: boolean) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? def) }))
  const problems = (data?.objs ?? []).filter((o) => stateOf(o) !== 'alive').length

  const openPath = (s: string) => {
    try {
      onSelect({ kind: 'root', root: { path: '', keys: parseLuaPath(s) } })
      setPathError('')
    } catch (e) {
      setPathError((e as Error).message)
    }
  }

  const lines: TreeLine[] = []
  const section = (key: string, icon: LucideIcon, label: string, count: number | string, def = true) => {
    const o = isOpen(key, def)
    lines.push({
      key,
      depth: 0,
      icon,
      label: <span className="ue:text-caption ue:font-medium ue:text-subtle">{label}</span>,
      aside: String(count),
      expandable: true,
      open: o,
      selected: false,
      clickToggles: true,
      onToggle: () => toggle(key, def),
    })
    return o
  }
  const selRoot = sel?.kind === 'root' ? sel.root : undefined
  // 检视区走到下层时，树里还亮着它的起点
  const under = (path: string, keys: (string | number)[]) =>
    !!selRoot &&
    selRoot.path === path &&
    selRoot.keys.length >= keys.length &&
    keys.every((k, i) => selRoot.keys[i] === k)

  const node = (n: TNode, depth: number, defOpen: boolean) => {
    const kids = n.children.length > 0
    const key = `${grouping}/${n.key}`
    const o = isOpen(key, defOpen)
    const base = { key, depth, expandable: kids, open: o, onToggle: () => toggle(key, defOpen) }
    if (n.kind === 'object') {
      const x = n.obj!
      const st = stateOf(x)
      lines.push({
        ...base,
        icon: isClassObj(x) ? Component : Box,
        label: (
          <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:font-mono">
            <StateDot state={st} />
            <span className="ue:truncate">
              <Hit text={x.name} q={q} />
            </span>
          </span>
        ),
        title: `${x.class} · ${x.path}`,
        aside: st !== 'alive' ? <StateBadge state={st} /> : undefined,
        selected: under(x.path, []),
        onSelect: () => onSelect({ kind: 'root', root: { path: x.path, keys: [], label: x.name } }),
      })
    } else {
      const group = n.kind === 'module' || n.kind === 'class'
      const name = n.kind === 'world' ? worldName(n.name) : n.name || t('（没认出模块）')
      lines.push({
        ...base,
        icon: n.kind === 'module' ? Braces : n.kind === 'class' ? Component : n.kind === 'world' ? Globe : Box,
        iconTone: n.kind === 'module' ? 'ue:text-accent-text' : n.kind === 'class' ? 'ue:text-run' : undefined,
        label: (
          <span className={n.kind === 'module' || n.kind === 'class' ? 'ue:font-mono' : undefined}>
            <Hit text={name} q={q} />
          </span>
        ),
        title: n.kind === 'owner' ? t('外层对象没绑 Lua，只当分组') : undefined,
        aside: n.count,
        selected: group && sel?.kind === 'group' && sel.name === n.name && sel.by === n.kind,
        clickToggles: !group,
        onSelect: group ? () => onSelect({ kind: 'group', by: n.kind as 'module' | 'class', name: n.name }) : undefined,
      })
    }
    if (kids && o) for (const c of n.children) node(c, depth + 1, defOpen)
  }

  const leaf = (key: string, icon: LucideIcon, label: string, root: { path: string; keys: string[]; label?: string }) =>
    lines.push({
      key,
      depth: 1,
      icon,
      label: (
        <span className="ue:font-mono">
          <Hit text={label} q={q} />
        </span>
      ),
      expandable: false,
      open: false,
      selected: under(root.path, root.keys),
      onSelect: () => onSelect({ kind: 'root', root }),
    })

  const leakLines = () => {
    if (!leaks) return
    if (section('s:leaks', Ghost, t('Lua 还拿着的已销毁对象'), leaks.length))
      leaks.forEach((x, i) =>
        lines.push({
          key: `leak:${i}`,
          depth: 1,
          icon: Ghost,
          iconTone: 'ue:text-danger',
          label: <span className="ue:font-mono">{x.module || x.class || t('（没认出模块）')}</span>,
          title: x.path,
          aside: x.path ? <span className="ue:font-mono">{x.path.split('.').slice(-2).join('.')}</span> : undefined,
          expandable: false,
          open: false,
          selected: sel?.kind === 'leak' && sel.item === x,
          onSelect: () => onSelect({ kind: 'leak', item: x }),
        }),
      )
  }

  const query = q.trim()
  if (data && query) {
    const r = search(query, objs, data.modules, data.globals)
    if (r.classes.length && section('s:byclass', Component, t('按类（含子类）'), r.classHits))
      for (const n of r.classes) node(n, 1, true)
    if (r.objects.length && section('s:named', Box, t('对象名'), r.objects.length))
      for (const n of r.objects) node(n, 1, true)
    if (r.modules.length && section('s:mods', Braces, t('模块'), r.modules.length))
      for (const m of r.modules) leaf(`mod:${m}`, Braces, m, { path: '', keys: ['package', 'loaded', m], label: m })
    if (r.globals.length && section('s:globals', Globe, t('全局'), r.globals.length))
      for (const g of r.globals) leaf(`g:${g}`, Globe, g, { path: '', keys: [g] })
    lines.push({
      key: 'path',
      depth: 0,
      icon: CornerDownRight,
      label: (
        <span className={isPathQuery(query) ? 'ue:text-fg' : 'ue:text-subtle'}>
          {t('按 Lua 路径打开')} <span className="ue:font-mono">{query}</span>
        </span>
      ),
      aside: isPathQuery(query) ? t('回车') : undefined,
      expandable: false,
      open: false,
      selected: false,
      onSelect: () => openPath(query),
    })
  } else if (data) {
    const groupLabel = { module: t('按 Lua 类'), class: t('按 UE 类'), owner: t('按归属') }[grouping]
    // 类（UClass）单独一组：没开始玩时 UnLua 只给类建了表，混在「运行中的对象」里会被当成实例去调 UE 函数
    const insts = objs.filter((o) => !isClassObj(o))
    const classObjs = objs.filter(isClassObj)
    if ((insts.length || !classObjs.length) && section('s:objects', Box, t('运行中的对象（{g}）', { g: groupLabel }), insts.length)) {
      const tree = groupObjects(insts, grouping)
      // 对象不多时全展开；多了只展开第一层分组，免得一打开就是几百行
      for (const n of tree) node(n, 1, insts.length <= 40)
    }
    if (classObjs.length && section('s:classobjs', Component, insts.length ? t('绑了 Lua 的类') : t('绑了 Lua 的类（还没开始玩，没有实例）'), classObjs.length, !insts.length)) {
      const tree = groupObjects(classObjs, grouping === 'owner' ? 'module' : grouping)
      for (const n of tree) node(n, 1, classObjs.length <= 40)
    }
    if (data.globals.length && section('s:globals', Globe, t('全局（项目自己的）'), data.globals.length))
      for (const g of data.globals) leaf(`g:${g}`, Globe, g, { path: '', keys: [g] })
    const idle = idleModules(data.modules, data.objs)
    if (idle.length && section('s:idle', FileCode2, t('只加载、没有对象的模块'), idle.length, false))
      for (const m of idle) leaf(`mod:${m}`, FileCode2, m, { path: '', keys: ['package', 'loaded', m], label: m })
  }
  leakLines()

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <SearchBox
          initial={q}
          placeholder={t('类名、对象名、模块或 Lua 路径')}
          live
          onSearch={(s) => {
            setQ(s)
            setPathError('')
          }}
          onEnter={(s) => isPathQuery(s) && openPath(s)}
          addon={
            <FilterButton
              label={t('按状态筛')}
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all' as const, label: t('全部') },
                { id: 'alive' as const, label: t('只看活着的') },
                { id: 'problem' as const, label: t('只看有问题的'), count: problems },
              ]}
            />
          }
        />
        <ErrorText>{pathError}</ErrorText>
        <div className="ue:flex ue:items-center ue:gap-2">
          <ui.Segmented
            size="sm"
            label={t('分组')}
            value={grouping}
            onChange={setGrouping}
            options={[
              { id: 'module' as const, label: t('Lua 类') },
              { id: 'class' as const, label: t('UE 类') },
              // 归属要 UELink 2.19 的 owner / world；旧版只能按 Lua 类和类名分
              ...(data && !data.rich ? [] : [{ id: 'owner' as const, label: t('归属') }]),
            ]}
          />
          <span className="ue:ml-auto" />
          <ui.IconButton icon={RefreshCw} size="sm" label={t('刷新')} onClick={onReload} />
        </div>
      </div>
      {error && (
        <div className="ue:px-3 ue:pt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {data && !lines.length && (
        <p className="ue:flex ue:items-center ue:justify-center ue:gap-1.5 ue:px-3 ue:py-6 ue:text-caption ue:text-subtle">
          <Search className="ue:h-3.5 ue:w-3.5" /> {t('没有对得上的')}
        </p>
      )}
      <TreeList lines={lines} label={t('Lua 对象')} />
      {footer}
      <StateLegend />
    </div>
  )
}
