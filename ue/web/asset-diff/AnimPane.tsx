import { Film } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AnimDiff } from '../../shared/asset-diff/types.ts'
import { h, t } from '../host.ts'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { Mark } from './PropGrid.tsx'

const OLD = 'ue:bg-(--c-grid-removed)/8 ue:text-(--c-grid-removed)'
const NEW = 'ue:bg-(--c-grid-edited)/12 ue:text-fg'
const ADD = 'ue:bg-(--c-grid-added)/10 ue:text-(--c-grid-added)'
const CELL = 'ue:flex ue:min-h-7 ue:min-w-0 ue:items-center ue:gap-1.5 ue:border-b ue:border-line/50 ue:px-3 ue:py-1'

/**
 * 控件蓝图的「动画」页签（设计稿「UE资源版本差异-修复与强化」3.7）：左边动画列表，右边选中动画的通道差异，
 * 每条通道「控件路径 · 通道 | 旧关键帧 | 新关键帧」，关键帧写成「秒→值」。分栏和其他页签一样可拖、记住宽度
 */
export function AnimPane({ anims, only, a, b }: { anims: AnimDiff[]; only: boolean; a: string; b: string }) {
  const { cn } = h()
  const list = anims.filter((x) => !only || x.change !== 'same')
  const [picked, setPicked] = useState('')
  const sel = list.find((x) => x.name === picked) ?? list[0]
  const pane = usePane('asset-diff.anims', '30%', 200)
  const ref = useRef<HTMLElement>(null)
  if (!sel) return <p className="ue:p-6 ue:text-body ue:text-subtle">{t('动画没变')}</p>
  const rows = sel.channels.filter((c) => !only || c.change !== 'same')
  return (
    <div className={cn(SPLIT_ROW, 'ue:min-h-0 ue:flex-1')}>
      <section ref={ref} className={cn(PANE_FIXED, 'ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto')} style={pane.style('70%')}>
        <div className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:px-3 ue:text-caption ue:text-subtle">{t('动画')}</div>
        <div className="ue:flex ue:flex-col ue:gap-px ue:px-1.5 ue:pb-2 ue:text-footnote">
          {list.map((x) => {
            const n = x.channels.filter((c) => c.change !== 'same').length
            return (
              <button
                key={x.name}
                type="button"
                onClick={() => setPicked(x.name)}
                className={cn(
                  'ue:flex ue:h-7 ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:px-1.5 ue:text-left ue:hover:bg-hover',
                  x === sel && 'ue:bg-sel ue:hover:bg-sel',
                )}
              >
                <Film className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                <span
                  className={cn(
                    'ue:min-w-0 ue:truncate ue:font-mono',
                    x.change === 'add' && 'ue:text-(--c-grid-added)',
                    x.change === 'del' && 'ue:text-(--c-grid-removed) ue:line-through',
                  )}
                >
                  {x.name}
                </span>
                <span className="ue:ml-auto ue:flex ue:shrink-0 ue:gap-1">
                  {x.change === 'add' ? (
                    <Mark kind="add">{t('新加')}</Mark>
                  ) : x.change === 'del' ? (
                    <Mark kind="del">{t('删掉')}</Mark>
                  ) : x.change === 'mod' ? (
                    <Mark kind="mod">{t('改 {n}', { n: Math.max(1, n) })}</Mark>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      <SplitHandle pane={pane} paneRef={ref} reserve={() => 360} />
      <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto')}>
        {sel.lengthA !== sel.lengthB && sel.lengthA !== undefined && sel.lengthB !== undefined && (
          <p className="ue:shrink-0 ue:border-b ue:border-line ue:bg-sel ue:px-3 ue:py-1.5 ue:text-footnote ue:text-muted">
            {t('长度 {a} 秒 → {b} 秒', { a: +sel.lengthA.toFixed(3), b: +sel.lengthB.toFixed(3) })}
          </p>
        )}
        <div className="ue:grid ue:grid-cols-[minmax(12rem,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] ue:text-footnote">
          <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{t('控件 · 通道')}</div>
          <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{a}</div>
          <div className={cn(CELL, 'ue:font-mono ue:text-caption ue:text-subtle')}>{b}</div>
          {rows.map((c) => (
            <div key={c.key} className="ue:contents">
              <div className={cn(CELL, c.change !== 'same' && 'ue:shadow-[inset_3px_0_0_var(--c-grid-edited)]')}>
                <span className="ue:truncate ue:font-mono" title={c.key}>
                  {c.key}
                </span>
              </div>
              <div className={cn(CELL, 'ue:font-mono', c.change === 'mod' || c.change === 'del' ? OLD : 'ue:text-muted')} title={c.a}>
                <span className="ue:truncate">{c.a ?? t('（没有这条通道）')}</span>
              </div>
              <div
                className={cn(CELL, 'ue:font-mono', c.change === 'add' ? ADD : c.change === 'mod' ? NEW : 'ue:text-muted')}
                title={c.b}
              >
                <span className="ue:truncate">{c.b ?? t('（删掉了）')}</span>
              </div>
            </div>
          ))}
          {!rows.length && <div className={cn(CELL, 'ue:col-span-full ue:text-subtle')}>{t('通道没变，只改了长度')}</div>}
        </div>
      </section>
    </div>
  )
}
