import { Box, Component, Rows3 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import type { PropRef } from '../../shared/asset-diff/prop-history.ts'
import type { ObjDiff, PropDiff } from '../../shared/asset-diff/types.ts'
import { h, t } from '../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Mark, PropGrid } from './PropGrid.tsx'

/** 左边列表里的一项：对象差异 + 缩进 + 显示名 */
interface Item {
  obj: ObjDiff
  depth: number
  name: string
  sub?: string
  icon: ReactNode
}

/** 组件按挂接关系排成树：父组件不在列表里的（C++ 父类的根、别的蓝图的）当根 */
function compItems(comps: ObjDiff[], base = 1): Item[] {
  const names = new Set(comps.map((c) => c.key))
  const out: Item[] = []
  const walk = (parent: string, depth: number) => {
    for (const c of comps.filter((x) => (x.parent ?? '') === parent && x.key !== parent)) {
      if (out.some((o) => o.obj === c)) continue
      out.push({ obj: c, depth, name: c.key, sub: c.class, icon: <Box className="ue:h-3 ue:w-3 ue:shrink-0" /> })
      walk(c.key, depth + 1)
    }
  }
  for (const c of comps.filter((x) => !x.parent || !names.has(x.parent))) {
    if (out.some((o) => o.obj === c)) continue
    out.push({ obj: c, depth: base, name: c.key, sub: c.class, icon: <Box className="ue:h-3 ue:w-3 ue:shrink-0" /> })
    walk(c.key, base + 1)
  }
  return out
}

/** 一项的标记：新加、删掉、改了几项 */
function marks(o: ObjDiff) {
  if (o.change === 'add') return <Mark kind="add">{t('新加')}</Mark>
  if (o.change === 'del') return <Mark kind="del">{t('删掉')}</Mark>
  if (o.change === 'mod') return <Mark kind="mod">{t('改 {n}', { n: o.count })}</Mark>
  return null
}

/**
 * 「类默认值与组件」「属性」「行」页签：左边是对象列表（蓝图的组件树、资源的内嵌子对象、数据表的行），右边是选中那个的属性差异。
 * 只看变化时左边也只列有变化的（类默认值 / 资源本身总在第一行）
 */
export function ObjPane({
  mode,
  self,
  objs,
  assetName,
  only,
  a,
  b,
  onRestore,
  onHistory,
}: {
  mode: 'blueprint' | 'widgets' | 'asset' | 'rows'
  self?: ObjDiff
  objs: ObjDiff[]
  assetName: string
  only: boolean
  a: string
  b: string
  /** 改回旧值：只有类默认值 / 资源本身能改（组件模板、行的路径这里拿不到） */
  onRestore?: (p: PropDiff) => void
  /** 「这个值的来历」：交出这个属性在快照里怎么找（shared/asset-diff/prop-history.ts） */
  onHistory?: (ref: PropRef, label: string) => void
}) {
  const { cn } = h()
  const items: Item[] = [
    ...(self
      ? [
          {
            obj: self,
            depth: 0,
            name: assetName,
            sub: mode === 'blueprint' ? t('（自我）') : t('资源本身'),
            icon: <Component className="ue:h-3 ue:w-3 ue:shrink-0" />,
          },
        ]
      : []),
    ...(mode === 'blueprint' || mode === 'widgets'
      ? compItems(objs, mode === 'widgets' ? 0 : 1)
      : objs.map((o) => ({
          obj: o,
          depth: mode === 'rows' ? 0 : 1,
          name: o.key,
          sub: mode === 'rows' ? undefined : o.class,
          icon:
            mode === 'rows' ? (
              <Rows3 className="ue:h-3 ue:w-3 ue:shrink-0" />
            ) : (
              <Box className="ue:h-3 ue:w-3 ue:shrink-0" />
            ),
        }))),
  ].filter((i) => !only || i.obj === self || i.obj.change !== 'same')
  const [picked, setPicked] = useState('')
  const sel = items.find((i) => keyOf(i) === picked) ?? items.find((i) => i.obj.change !== 'same') ?? items[0]
  const pane = usePane('asset-diff.objs', '30%', 200)
  const ref = useRef<HTMLElement>(null)
  if (!sel)
    return (
      <p className="ue:p-6 ue:text-body ue:text-subtle">
        {mode === 'rows' ? t('数据表的行没变') : mode === 'widgets' ? t('控件树没变') : t('这一页没有变化')}
      </p>
    )
  return (
    <div className={cn(SPLIT_ROW, 'ue:min-h-0 ue:flex-1')}>
      <section
        ref={ref}
        className={cn(PANE_FIXED, 'ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto')}
        style={pane.style('70%')}
      >
        <div className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:px-3 ue:text-caption ue:text-subtle">
          {mode === 'rows' ? t('行') : mode === 'blueprint' ? t('组件') : mode === 'widgets' ? t('控件') : t('对象')}
          <span className="ue:ml-auto">{t('点一项看它的属性差异')}</span>
        </div>
        <div className="ue:flex ue:flex-col ue:gap-px ue:px-1.5 ue:pb-2 ue:text-footnote">
          {items.map((i) => (
            <button
              key={keyOf(i)}
              type="button"
              onClick={() => setPicked(keyOf(i))}
              style={{ paddingLeft: 6 + i.depth * 14 }}
              className={cn(
                'ue:flex ue:h-7 ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:pr-1.5 ue:text-left ue:hover:bg-hover',
                i === sel && 'ue:bg-sel ue:hover:bg-sel',
              )}
            >
              <span className="ue:text-subtle">{i.icon}</span>
              <span
                className={cn(
                  'ue:min-w-0 ue:truncate ue:font-mono',
                  i.obj.change === 'add' && 'ue:text-(--c-grid-added)',
                  i.obj.change === 'del' && 'ue:text-(--c-grid-removed) ue:line-through',
                )}
                title={i.name}
              >
                {i.name}
              </span>
              {i.sub && <span className="ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">{i.sub}</span>}
              <span className="ue:ml-auto ue:flex ue:shrink-0 ue:gap-1">{marks(i.obj)}</span>
            </button>
          ))}
        </div>
      </section>
      <SplitHandle pane={pane} paneRef={ref} reserve={() => 360} />
      <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto')}>
        {sel.obj !== self && (
          <p className="ue:flex ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-sel ue:px-3 ue:py-1.5 ue:text-footnote ue:text-muted">
            <span className="ue:font-mono ue:text-fg">{sel.name}</span>
            {sel.sub && <span>{sel.sub}</span>}
            {sel.obj.parent && <span>{t('挂在 {p} 下', { p: sel.obj.parent })}</span>}
            {sel.obj.source === 'inherited' && <span>{t('父蓝图的组件，在这个蓝图里改过')}</span>}
            {sel.obj.change === 'add' && <span>{t('新加的：属性都算新加')}</span>}
            {sel.obj.change === 'del' && <span>{t('删掉的：下面是旧版的属性')}</span>}
          </p>
        )}
        <PropGrid
          obj={sel.obj}
          only={only}
          a={a}
          b={b}
          onRestore={sel.obj === self ? onRestore : undefined}
          onHistory={onHistory && ((p) => onHistory(refOf(mode, sel.obj, sel.obj === self, p), `${sel.name} · ${p.label || p.name}`))}
        />
      </section>
    </div>
  )
}

const keyOf = (i: Item) => `${i.obj.source ?? ''}:${i.obj.key}`

/** 列表里的一项对应快照里的哪个对象（和 diff.ts 起 key 的方式一致） */
function refOf(mode: 'blueprint' | 'widgets' | 'asset' | 'rows', o: ObjDiff, isSelf: boolean, p: PropDiff): PropRef {
  if (isSelf) return { kind: 'defaults', key: '', prop: p.name }
  if (mode === 'blueprint') return { kind: 'component', key: o.key, source: o.source, prop: p.name }
  if (mode === 'widgets') return { kind: 'widget', key: o.key, prop: p.name }
  if (mode === 'rows') return { kind: 'row', key: o.key, prop: p.name }
  return { kind: 'subobject', key: o.key, prop: p.name }
}
