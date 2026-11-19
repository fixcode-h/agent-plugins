import { ChevronDown, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ObjDiff, PropDiff } from '../../shared/asset-diff/types.ts'
import { labelOf, splitCategory } from '../details/model.ts'
import { h, t } from '../host.ts'
import { fmtValue, fullValue } from './format.ts'

/** 改动的颜色：旧值红、新值改过的蓝底（和表格版本差异一样取 --c-grid-* 变量）、新加的绿 */
const OLD = 'ue:bg-(--c-grid-removed)/8 ue:text-(--c-grid-removed)'
const NEW = 'ue:bg-(--c-grid-edited)/12 ue:text-fg'
const ADD = 'ue:bg-(--c-grid-added)/10 ue:text-(--c-grid-added)'
const CELL = 'ue:flex ue:min-h-7 ue:min-w-0 ue:items-center ue:gap-1.5 ue:border-b ue:border-line/50 ue:px-3 ue:py-1'

/**
 * 一个对象的属性差异：三列「属性 | 旧版 | 新版」，按 UE 的分类分组、名字和资源页一样；结构体、数组展开到改了的那几处。
 * 只看变化时没变的项折成一行「其余 N 项没变」。onRestore 给了（本地改动、编辑器里的那份）就在改了的行尾放「改回旧值」
 */
export function PropGrid({
  obj,
  only,
  a,
  b,
  onRestore,
}: {
  obj: ObjDiff
  only: boolean
  a: string
  b: string
  onRestore?: (p: PropDiff) => void
}) {
  const { cn } = h()
  const groups = new Map<string, PropDiff[]>()
  for (const p of obj.props) {
    const g = splitCategory(p.category).top
    groups.set(g, [...(groups.get(g) ?? []), p])
  }
  let hidden = 0
  let hiddenGroups = 0
  const cols = onRestore
    ? 'ue:grid-cols-[minmax(10rem,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_2rem]'
    : 'ue:grid-cols-[minmax(10rem,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]'
  const rows = [...groups].map(([g, props]) => {
    const shown = only ? props.filter((p) => p.change !== 'same') : props
    hidden += props.length - shown.length
    if (!shown.length) {
      hiddenGroups++
      return null
    }
    const n = props.filter((p) => p.change !== 'same').length
    return (
      <div key={g} className="ue:contents">
        <div className={cn(CELL, 'ue:col-span-full ue:bg-fg/[0.03] ue:font-medium')}>
          <ChevronDown className="ue:h-3 ue:w-3 ue:text-subtle" />
          {g}
          {n > 0 && <Mark kind="mod">{t('改 {n}', { n })}</Mark>}
        </div>
        {shown.map((p) => (
          <PropRows key={p.name} p={p} restore={onRestore} />
        ))}
        {only && shown.length < props.length && (
          <div className={cn(CELL, 'ue:col-span-full ue:justify-center ue:text-caption ue:text-subtle')}>
            {t('… 其余 {n} 项没变 …', { n: props.length - shown.length })}
          </div>
        )}
      </div>
    )
  })
  return (
    <div className={cn('ue:grid ue:text-footnote', cols)}>
      <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{t('属性')}</div>
      <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{a}</div>
      <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{b}</div>
      {onRestore && <div className={CELL} />}
      {rows}
      {only && hiddenGroups > 0 && (
        <div className={cn(CELL, 'ue:col-span-full ue:justify-center ue:text-caption ue:text-subtle')}>
          {t('… 其余 {g} 组、{n} 项没变，点「全部」看 …', { g: hiddenGroups, n: hidden })}
        </div>
      )}
      {!obj.props.length && <div className={cn(CELL, 'ue:col-span-full ue:text-subtle')}>{t('没有存盘的属性')}</div>}
    </div>
  )
}

function PropRows({ p, restore }: { p: PropDiff; restore?: (p: PropDiff) => void }) {
  const { cn, ui } = h()
  const label = labelOf({
    name: p.name,
    type: typeof p.a === 'boolean' ? 'bool' : '',
    displayName: p.label,
    value: null,
  })
  const changed = p.change !== 'same'
  const left = p.change === 'add' ? '' : fmtValue(p.a)
  const right = p.change === 'del' ? '' : fmtValue(p.b)
  return (
    <>
      <div
        className={cn(CELL, changed && 'ue:shadow-[inset_3px_0_0_var(--c-grid-edited)]')}
        title={p.name !== label ? p.name : undefined}
      >
        <span className="ue:truncate">{label}</span>
      </div>
      <div
        className={cn(CELL, 'ue:font-mono', p.change === 'mod' || p.change === 'del' ? OLD : 'ue:text-muted')}
        title={p.change === 'add' ? undefined : fullValue(p.a)}
      >
        {p.change === 'add' ? <span className="ue:text-caption ue:text-subtle">{t('（没有这一项）')}</span> : left}
      </div>
      <div
        className={cn(CELL, 'ue:font-mono', p.change === 'add' ? ADD : p.change === 'mod' ? NEW : 'ue:text-muted')}
        title={p.change === 'del' ? undefined : fullValue(p.b)}
      >
        {p.change === 'del' ? <span className="ue:text-caption ue:text-subtle">{t('（删掉了）')}</span> : right}
      </div>
      {restore && (
        <div className={cn(CELL, 'ue:justify-center ue:px-0')}>
          {p.change === 'mod' && (
            <ui.IconButton icon={Undo2} size="sm" label={t('这一项改回旧值')} onClick={() => restore(p)} />
          )}
        </div>
      )}
      {p.leaves?.map((l) => (
        <div key={l.path} className="ue:contents">
          <div className={cn(CELL, 'ue:pl-7 ue:font-mono ue:text-muted')}>
            <span className="ue:truncate" title={l.path}>
              {l.path}
            </span>
          </div>
          <div className={cn(CELL, 'ue:font-mono', l.change === 'add' ? 'ue:text-subtle' : OLD)} title={fullValue(l.a)}>
            {l.change === 'add' ? '' : fmtValue(l.a)}
          </div>
          <div
            className={cn(CELL, 'ue:font-mono', l.change === 'add' ? ADD : l.change === 'del' ? 'ue:text-subtle' : NEW)}
            title={fullValue(l.b)}
          >
            {l.change === 'del' ? t('（删掉了）') : fmtValue(l.b)}
          </div>
          {restore && <div className={CELL} />}
        </div>
      ))}
      {!!p.more && (
        <div className={cn(CELL, 'ue:col-span-full ue:pl-7 ue:text-caption ue:text-subtle')}>
          {t('还有 {n} 处改动没列出来', { n: p.more })}
        </div>
      )}
    </>
  )
}

/** 小标签：加（绿）、删（红）、改（蓝底） */
export function Mark({ kind, children }: { kind: 'add' | 'del' | 'mod'; children: ReactNode }) {
  const { cn } = h()
  return (
    <span
      className={cn(
        'ue:inline-flex ue:h-4 ue:shrink-0 ue:items-center ue:rounded-(--c-badge-radius) ue:px-1 ue:text-caption ue:leading-none ue:font-normal ue:whitespace-nowrap',
        kind === 'add'
          ? 'ue:bg-(--c-grid-added)/13 ue:text-(--c-grid-added)'
          : kind === 'del'
            ? 'ue:bg-(--c-grid-removed)/12 ue:text-(--c-grid-removed)'
            : 'ue:bg-(--c-grid-edited)/16 ue:text-fg',
      )}
    >
      {children}
    </span>
  )
}
