import { Eye, EyeOff, Spline } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import { Card } from '../../../ui.tsx'
import type { Curve } from './model.ts'

/** 曲线列表（效果图 B9 左栏）：每条曲线的颜色、名字、键数，眼睛开关在图上显不显示；点名字只看这一条的关键帧表 */
export function CurveList({
  curves,
  hidden,
  onToggle,
  active,
  onActive,
}: {
  curves: Curve[]
  hidden: Set<string>
  onToggle: (id: string) => void
  active: string
  onActive: (id: string) => void
}) {
  const { cn, ui } = h()
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <Spline className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('曲线')}
        </>
      }
      aside={<span>{t('{n} 条', { n: curves.length })}</span>}
      bodyClass="ue:overflow-auto ue:py-1"
    >
      {curves.map((c) => (
        <div
          key={c.id}
          className={cn(
            'ue:flex ue:h-7 ue:items-center ue:gap-2 ue:pr-1 ue:pl-3 ue:text-footnote',
            active === c.id ? 'ue:bg-sel' : 'ue:hover:bg-hover',
            hidden.has(c.id) && 'ue:opacity-50',
          )}
        >
          <button
            type="button"
            aria-pressed={active === c.id}
            onClick={() => onActive(active === c.id ? '' : c.id)}
            className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:text-left ue:text-fg"
          >
            <span className="ue:h-2 ue:w-2 ue:shrink-0 ue:rounded-full" style={{ background: toneColor(c.tone) }} />
            <span className="ue:min-w-0 ue:flex-1 ue:truncate">{c.label}</span>
            <span className="ue:font-mono ue:text-caption ue:text-subtle">{t('{n} 键', { n: c.keys.length })}</span>
          </button>
          <ui.IconButton
            icon={hidden.has(c.id) ? EyeOff : Eye}
            label={hidden.has(c.id) ? t('在图上显示') : t('在图上隐藏')}
            size="2xs"
            onClick={() => onToggle(c.id)}
          />
        </div>
      ))}
      {!curves.length && <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">{t('没有读到曲线')}</p>}
    </Card>
  )
}
