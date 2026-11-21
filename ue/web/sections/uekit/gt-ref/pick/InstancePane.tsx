import { AppWindow, Box, CircleCheck } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import type { GtIdentItem, GtTreeNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { openMenu } from '../../../../menu.tsx'
import { PathChips } from '../../../../path-chips/PathChips.tsx'
import { TreeList, type TreeLine } from '../../../../TreeList.tsx'
import { testIdent } from '../compare-table.ts'
import { classShort } from '../describe.ts'
import type { RefHits } from '../live.ts'

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
}) {
  const { cn } = h()
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
        <p className="ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">{t('此刻一个也没有：先在游戏里打开它')}</p>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-0.5 ue:overflow-auto ue:px-2 ue:pb-2">
        {rows.map((c) => {
          const hit = mine.has(c.name)
          const actual = new Map((c.ident ?? []).map((x) => [x.prop, x.actual]))
          const why = hit
            ? undefined
            : ident.find((it) => actual.has(it.prop) && testIdent(it, actual.get(it.prop)) === false)
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onSelect(c.name)}
              className={cn(
                'ue:flex ue:cursor-pointer ue:flex-col ue:items-start ue:rounded-md ue:px-2 ue:py-1.5 ue:text-left',
                selected === c.name ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <span className="ue:max-w-full ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{c.name}</span>
              <span
                className={cn(
                  'ue:flex ue:max-w-full ue:items-center ue:gap-1 ue:text-caption',
                  hit && mine.size === 1 ? 'ue:text-success' : hit ? 'ue:text-warning' : 'ue:text-subtle',
                )}
              >
                {hit ? (mine.size === 1 ? t('就是它') : t('也命中：再加标识区分')) : t('被标识排除')}
                {why && <PathChips path={why.prop} small />}
              </span>
            </button>
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
