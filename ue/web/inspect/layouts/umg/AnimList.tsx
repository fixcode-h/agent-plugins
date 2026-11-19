import { Film } from 'lucide-react'
import { h, t } from '../../../host.ts'
import type { Anim } from '../../../timeline/keys.ts'
import { Card } from '../../../ui.tsx'

/** 动画列表（效果图 U1 左下）：名字、长度、轨道数；点一下在底部时间轴打开 */
export function AnimList({
  anims,
  current,
  onPick,
  source,
}: {
  anims: Anim[]
  current?: string
  onPick: (name: string) => void
  source?: string
}) {
  const { cn } = h()
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={t('动画')}
      aside={
        <span className="ue:truncate">
          {anims.length}
          {source ? ` · ${source}` : ''}
        </span>
      }
      bodyClass="ue:overflow-auto ue:py-1"
    >
      {!anims.length && <p className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">{t('这个控件蓝图没有动画')}</p>}
      {anims.map((a) => (
        <button
          key={a.name}
          type="button"
          aria-pressed={a.name === current}
          onClick={() => onPick(a.name)}
          className={cn(
            'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:text-left ue:text-footnote ue:transition-colors',
            a.name === current ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
          )}
        >
          <Film className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
          <span className="ue:min-w-0 ue:flex-1 ue:truncate">{a.name}</span>
          <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">
            {a.length.toFixed(2)}s · {t('{n} 轨', { n: a.tracks.length })}
          </span>
        </button>
      ))}
    </Card>
  )
}
