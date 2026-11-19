import type { AssetDiff, VarDiff } from '../../shared/asset-diff/types.ts'
import { h, t } from '../host.ts'
import { Mark } from './PropGrid.tsx'

const CELL = 'ue:flex ue:min-h-7 ue:min-w-0 ue:items-center ue:gap-1.5 ue:border-b ue:border-line/50 ue:px-3 ue:py-1'

/** 父类、接口这类设置的显示名 */
const settingLabel = (k: string) =>
  (
    ({ class: t('资源类型'), parent: t('父类'), interfaces: t('接口'), rowStruct: t('行结构') }) as Record<
      string,
      string
    >
  )[k] ?? k

/** 变量的一行描述：类型、分类、标记 */
const varText = (v: VarDiff['a']) =>
  v ? [v.type, v.category && t('分类 {c}', { c: v.category }), ...v.flags].filter(Boolean).join(' · ') : ''

/** 「变量与设置」页签：父类、接口这类蓝图设置的变化，加上变量的增删改（类型、分类、复制、实例可编辑…） */
export function VarsPane({ diff, only, a, b }: { diff: AssetDiff; only: boolean; a: string; b: string }) {
  const { cn } = h()
  const vars = only ? diff.variables.filter((v) => v.change !== 'same') : diff.variables
  if (!diff.settings.length && !vars.length)
    return <p className="ue:p-6 ue:text-body ue:text-subtle">{t('变量和设置都没变')}</p>
  return (
    <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
      <div className="ue:grid ue:grid-cols-[minmax(10rem,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] ue:text-footnote">
        <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{t('名字')}</div>
        <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{a}</div>
        <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{b}</div>
        {diff.settings.length > 0 && (
          <div className={cn(CELL, 'ue:col-span-full ue:bg-fg/[0.03] ue:font-medium')}>{t('设置')}</div>
        )}
        {diff.settings.map((s) => (
          <div key={s.label} className="ue:contents">
            <div className={cn(CELL, 'ue:shadow-[inset_3px_0_0_var(--c-grid-edited)]')}>{settingLabel(s.label)}</div>
            <div className={cn(CELL, 'ue:font-mono ue:whitespace-pre-wrap ue:text-(--c-grid-removed)')}>
              {s.a || '—'}
            </div>
            <div className={cn(CELL, 'ue:font-mono ue:whitespace-pre-wrap')}>{s.b || '—'}</div>
          </div>
        ))}
        {vars.length > 0 && (
          <div className={cn(CELL, 'ue:col-span-full ue:bg-fg/[0.03] ue:font-medium')}>{t('变量')}</div>
        )}
        {vars.map((v) => (
          <div key={v.name} className="ue:contents">
            <div className={cn(CELL, v.change !== 'same' && 'ue:shadow-[inset_3px_0_0_var(--c-grid-edited)]')}>
              <span
                className={cn(
                  'ue:truncate ue:font-mono',
                  v.change === 'add' && 'ue:text-(--c-grid-added)',
                  v.change === 'del' && 'ue:text-(--c-grid-removed) ue:line-through',
                )}
              >
                {v.name}
              </span>
              {v.change === 'add' && <Mark kind="add">{t('新加')}</Mark>}
              {v.change === 'del' && <Mark kind="del">{t('删掉')}</Mark>}
            </div>
            <div className={cn(CELL, v.change === 'mod' ? 'ue:text-(--c-grid-removed)' : 'ue:text-muted')}>
              {varText(v.a)}
            </div>
            <div
              className={cn(
                CELL,
                v.change === 'add' && 'ue:text-(--c-grid-added)',
                v.change === 'same' && 'ue:text-muted',
              )}
            >
              {varText(v.b)}
            </div>
          </div>
        ))}
      </div>
      <p className="ue:px-3 ue:py-2 ue:text-caption ue:text-subtle">
        {t('变量的默认值在「类默认值与组件」页签里（存在类默认值上）')}
      </p>
    </div>
  )
}
