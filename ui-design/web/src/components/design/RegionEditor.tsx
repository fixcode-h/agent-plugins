import { X } from 'lucide-react'
import type { LayoutRegion } from '@shared/design'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'

/**
 * 版式拆解的区块画在模板图上：拖动整块移动，拖右下角改大小，点名字改名，选中后可以删。
 * 坐标存的是设计稿像素，k 是「屏幕像素 / 设计稿像素」。确认之后只读显示（淡一点），不挡标注
 */
export function RegionEditor({
  regions,
  k,
  designSize,
  editable,
  active,
  onActive,
  onChange,
}: {
  regions: LayoutRegion[]
  k: number
  designSize: { X: number; Y: number }
  editable: boolean
  active: string
  onActive: (id: string) => void
  onChange: (regions: LayoutRegion[], key: string) => void
}) {
  const clamp = (g: LayoutRegion): LayoutRegion => {
    const w = Math.max(8, Math.min(Math.round(g.w), designSize.X))
    const h = Math.max(8, Math.min(Math.round(g.h), designSize.Y))
    return {
      ...g,
      w,
      h,
      x: Math.max(0, Math.min(Math.round(g.x), designSize.X - w)),
      y: Math.max(0, Math.min(Math.round(g.y), designSize.Y - h)),
    }
  }
  const drag = (e: React.PointerEvent, g: LayoutRegion, mode: 'move' | 'resize') => {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    onActive(g.id)
    const sx = e.clientX
    const sy = e.clientY
    const key = `layout:${mode}:${g.id}:${Date.now()}`
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / k
      const dy = (ev.clientY - sy) / k
      const next = mode === 'move' ? { ...g, x: g.x + dx, y: g.y + dy } : { ...g, w: g.w + dx, h: g.h + dy }
      onChange(
        regions.map((x) => (x.id === g.id ? clamp(next) : x)),
        key,
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className={cn('ud:absolute ud:inset-0', !editable && 'ud:pointer-events-none')} data-region-editor>
      {regions.map((g) => {
        const on = editable && g.id === active
        return (
          <div
            key={g.id}
            data-region={g.name}
            onPointerDown={(e) => drag(e, g, 'move')}
            className={cn(
              'ud:absolute ud:rounded-sm ud:border-2 ud:border-dashed',
              editable ? 'ud:cursor-move ud:border-accent ud:bg-accent/10' : 'ud:border-accent/45',
              on && 'ud:border-solid ud:bg-accent/15',
            )}
            style={{ left: g.x * k, top: g.y * k, width: g.w * k, height: g.h * k }}
            title={g.note || g.name}
          >
            <span
              className={cn(
                'ud:absolute ud:left-0 ud:flex ud:max-w-[16rem] ud:items-center ud:gap-1 ud:rounded-sm ud:px-1 ud:py-px ud:text-caption ud:whitespace-nowrap',
                // 贴着图片顶边的区块：名字放进框里，不然被图片边缘切掉
                g.y * k < 22 ? 'ud:top-0' : 'ud:-top-[1.4rem]',
                editable ? 'ud:bg-accent ud:text-on-primary' : 'ud:bg-accent/60 ud:text-on-primary',
              )}
            >
              {on ? (
                <input
                  aria-label={t('区块名')}
                  value={g.name}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    onChange(
                      regions.map((x) =>
                        x.id === g.id ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') || x.name } : x,
                      ),
                      `layout:name:${g.id}`,
                    )
                  }
                  className="ud:w-28 ud:bg-transparent ud:font-mono ud:outline-none"
                />
              ) : (
                <span className="ud:truncate ud:font-mono">{g.name}</span>
              )}
              {on && (
                <button
                  type="button"
                  aria-label={t('删除区块 {name}', { name: g.name })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    onChange(
                      regions.filter((x) => x.id !== g.id),
                      `layout:rm:${g.id}`,
                    )
                  }
                  className="ud:cursor-pointer ud:opacity-80 ud:hover:opacity-100"
                >
                  <X className="ud:h-3 ud:w-3" />
                </button>
              )}
            </span>
            {editable && (
              <span
                aria-hidden
                onPointerDown={(e) => drag(e, g, 'resize')}
                className="ud:absolute ud:-right-1.5 ud:-bottom-1.5 ud:h-3 ud:w-3 ud:cursor-nwse-resize ud:rounded-sm ud:border ud:border-white ud:bg-accent"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
