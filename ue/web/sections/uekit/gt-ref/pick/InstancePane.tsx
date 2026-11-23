import { AppWindow, Box, ChevronDown, ChevronRight, CircleCheck, Crosshair } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import type { GtIdentItem, GtTreeNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { openMenu } from '@panel/web/src/components/ui/item-menu'
import { PathChips } from '../../../../path-chips/PathChips.tsx'
import { TreeList, type TreeLine } from '@panel/web/src/components/ui/tree/tree-list'
import { testIdent } from '../compare-table.ts'
import { classShort } from '../describe.ts'
import type { RefHits } from '../live.ts'
import { ownerRows } from './owner-tree.ts'

/**
 * 第 1 栏「此刻实例」。定了类：这个类此刻的每个实例（gt.resolve 只按类的候选），按标识组命中的标「就是它」，
 * 别的写被哪条标识排除；点一个看它的结构和属性。没定类：列此刻屏上的界面类（gt.tree 的 UserWidget），
 * 双击或右键「选这个类」定类。没连游戏时只给提示（类树和属性结构照样能看）
 */
export function InstancePane({
  live,
  cls,
  screen,
  ident,
  me,
  all,
  error,
  selected,
  onSelect,
  onUseClass,
  onTake,
  taken,
  takeMode,
}: {
  live: boolean
  cls: string
  /** 此刻屏上的 UserWidget（gt.tree），没定类时按类分组列出来 */
  screen: GtTreeNode[]
  ident: GtIdentItem[]
  me?: RefHits
  all?: RefHits
  error?: string
  selected?: string
  onSelect: (name: string) => void
  onUseClass: (cls: string, instance?: string) => void
  /** 抓取值、要填的是对象时：实例行尾有准星，取这个对象本身 */
  onTake?: (name: string) => void
  /** 已经取了的实例名 */
  taken?: string
  /** 抓取值弹窗：只是选实例，不显示「就是它 / 被标识排除」（那是定标识用的） */
  takeMode?: boolean
}) {
  const { cn } = h()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const toggle = (k: string) =>
    setClosed((s) => {
      const x = new Set(s)
      if (x.has(k)) x.delete(k)
      else x.add(k)
      return x
    })
  const head = 'ue:px-3 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-muted'
  if (!live)
    return (
      <>
        <span className={head}>{t('此刻实例')}</span>
        <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
          {t('没连着游戏：这里列不出实例。类树和属性结构照样能看，开着游戏时能看到此刻的实例和值')}
        </p>
      </>
    )
  if (!cls) return <ScreenClasses screen={screen} onUseClass={onUseClass} />
  const mine = new Set((me?.candidates ?? []).map((c) => c.name))
  const rows = all?.candidates ?? []
  // 按所属（对象路径里的外层）成树，默认全展开，点分组行收起
  // 纯 Lua 实例（GameTest 2.2.0）没有外层对象：都归到「纯 Lua 实例」一组
  const tree = ownerRows(
    rows,
    (c) => (c.luaTable ? `${t('纯 Lua 实例')}.x` : c.path),
    (k) => !closed.has(k),
  )
  return (
    <>
      <span
        title={cls}
        className={cn(head, 'ue:flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-x-1.5 ue:break-all')}
      >
        {t('此刻的 {c}', { c: classShort(cls) })}
        {typeof me?.count === 'number' && (
          <span
            className={cn(
              'ue:flex ue:items-center ue:gap-1 ue:font-normal',
              me.count === 1 ? 'ue:text-success' : 'ue:text-warning',
            )}
          >
            {me.count === 1 && <CircleCheck className="ue:h-3.5 ue:w-3.5" />}
            {t('· 命中 {n} 个', { n: me.count })}
          </span>
        )}
      </span>
      {error && <p className="ue:px-3 ue:text-caption ue:text-warning">{error}</p>}
      {!error && all && !rows.length && (
        <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
          {cls.startsWith('lua:')
            ? t(
                '此刻一个也没有：绑了 UObject 的和纯 Lua 实例都没找到。纯 Lua 实例找不到时，到「权限与设置 → Lua」填类名字段或起点变量，点「试一下」看认没认出来',
              )
            : t('此刻一个也没有：先在游戏里打开它')}
        </p>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-0.5 ue:overflow-auto ue:px-2 ue:pb-2">
        {tree.map((r) => {
          if (r.label !== undefined)
            return (
              <button
                key={r.key}
                type="button"
                title={r.label}
                onClick={() => toggle(r.key)}
                style={{ paddingLeft: 8 + r.depth * 14 }}
                className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-md ue:py-1 ue:pr-2 ue:text-left ue:text-footnote ue:text-muted ue:hover:bg-hover"
              >
                {closed.has(r.key) ? (
                  <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
                ) : (
                  <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
                )}
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono">{r.label}</span>
                <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{r.count}</span>
              </button>
            )
          const c = r.item!
          const hit = mine.has(c.name)
          const actual = new Map((c.ident ?? []).map((x) => [x.prop, x.actual]))
          const why = hit
            ? undefined
            : ident.find((it) => actual.has(it.prop) && testIdent(it, actual.get(it.prop)) === false)
          const row = (
            <button
              key={c.name}
              type="button"
              title={c.luaTable ? `${c.luaTable.module}\n${c.luaTable.path}` : c.path}
              onClick={() => onSelect(c.name)}
              style={{ marginLeft: r.depth * 14 }}
              className={cn(
                'ue:flex ue:cursor-pointer ue:flex-col ue:items-start ue:rounded-md ue:px-2 ue:py-1.5 ue:text-left',
                selected === c.name ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <span className="ue:max-w-full ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{c.name}</span>
              {!takeMode && (
                <span
                  className={cn(
                    'ue:flex ue:max-w-full ue:items-center ue:gap-1 ue:text-caption',
                    hit && mine.size === 1 ? 'ue:text-success' : hit ? 'ue:text-warning' : 'ue:text-subtle',
                  )}
                >
                  {hit ? (mine.size === 1 ? t('就是它') : t('也命中：再加标识区分')) : t('被标识排除')}
                  {why && <PathChips path={why.prop} small />}
                </span>
              )}
            </button>
          )
          // 抓取对象：纯 Lua 实例不是 UObject，不能当对象填
          if (!onTake || c.luaTable) return row
          const on = taken === c.name
          return (
            <div key={c.name} className="ue:flex ue:items-center ue:gap-1">
              <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">{row}</div>
              <button
                type="button"
                aria-pressed={on}
                aria-label={on ? t('不取这个对象') : t('取这个对象')}
                title={on ? t('不取这个对象') : t('取这个对象')}
                onClick={() => onTake(c.name)}
                className={cn(
                  'ue:flex ue:h-6 ue:w-6 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-md',
                  on ? 'ue:bg-accent ue:text-on-accent' : 'ue:text-subtle ue:hover:bg-hover ue:hover:text-fg',
                )}
              >
                <Crosshair className="ue:h-3.5 ue:w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** 没定类：此刻屏上的界面按类分组，类下面是实例；双击类、右键「选这个类」定类 */
function ScreenClasses({
  screen,
  onUseClass,
}: {
  screen: GtTreeNode[]
  onUseClass: (cls: string, instance?: string) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const groups = useMemo(() => {
    const m = new Map<string, GtTreeNode[]>()
    for (const n of screen) if (n.user && !n.owner) m.set(n.class, [...(m.get(n.class) ?? []), n])
    return [...m.entries()]
  }, [screen])
  const lines: TreeLine[] = []
  for (const [cls, list] of groups) {
    const isOpen = open.has(cls)
    const menu = (e: MouseEvent, inst?: string) => {
      e.preventDefault()
      openMenu(e, [{ label: t('选这个类'), icon: AppWindow, onClick: () => onUseClass(cls, inst) }])
    }
    lines.push({
      key: cls,
      depth: 0,
      icon: AppWindow,
      iconTone: 'ue:text-accent',
      label: <span className="ue:font-mono">{classShort(cls)}</span>,
      aside: t('{n} 个', { n: list.length }),
      expandable: true,
      open: isOpen,
      selected: false,
      onToggle: () =>
        setOpen((s) => {
          const x = new Set(s)
          if (x.has(cls)) x.delete(cls)
          else x.add(cls)
          return x
        }),
      onDouble: () => onUseClass(cls),
      onMenu: (e) => menu(e),
    })
    if (isOpen)
      for (const n of list)
        lines.push({
          key: n.id,
          depth: 1,
          icon: Box,
          label: (
            <span>
              {n.name || classShort(n.class)}
              {n.text && <span className="ue:ml-1.5 ue:text-subtle">「{n.text}」</span>}
            </span>
          ),
          expandable: false,
          open: false,
          selected: false,
          onDouble: () => onUseClass(cls, n.name),
          onMenu: (e) => menu(e, n.name),
        })
  }
  return (
    <>
      <span className="ue:px-3 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-muted">
        {t('此刻屏上的界面')}
      </span>
      {!groups.length && <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">{t('此刻屏上没有界面')}</p>}
      <TreeList lines={lines} label={t('此刻屏上的界面')} />
      <p className="ue:px-3 ue:py-2 ue:text-caption ue:leading-relaxed ue:text-subtle">
        {t('双击一个界面类、或右键「选这个类」定类；也可以在顶上的类下拉里打字搜。')}
      </p>
    </>
  )
}
