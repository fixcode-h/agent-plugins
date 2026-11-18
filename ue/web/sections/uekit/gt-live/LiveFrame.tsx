import { Crosshair, Loader2, MonitorOff } from 'lucide-react'
import { h, t } from '../../../host.ts'
import type { Frame } from './use-pick.ts'

/**
 * 游戏的实时画面（效果图 3 / 10）：点一下就在那个位置抓控件（视口归一化坐标），抓到的控件画一个框。
 * 画面是 GameTest 截的游戏视口（含界面），按设置的帧率推过来，没变化时不推
 */
export function LiveFrame({
  frame,
  rect,
  label,
  busy,
  error,
  onPick,
}: {
  frame?: Frame
  /** 抓到的控件在视口里的归一化 [x, y, w, h] */
  rect?: number[]
  label?: string
  busy?: boolean
  error?: string
  onPick: (x: number, y: number) => void
}) {
  const { cn } = h()
  if (!frame)
    return (
      <div className="ue:flex ue:aspect-video ue:w-full ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-term ue:text-footnote ue:text-subtle">
        {error ? <MonitorOff className="ue:h-5 ue:w-5" /> : <Loader2 className="ue:h-5 ue:w-5 ue:animate-spin" />}
        <span className="ue:max-w-[80%] ue:text-center">{error || t('等游戏画面…')}</span>
      </div>
    )
  return (
    <div
      className="ue:relative ue:w-full ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-term"
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      <img
        src={`data:image/jpeg;base64,${frame.jpg}`}
        alt={t('游戏画面')}
        draggable={false}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
        }}
        className={cn('ue:block ue:h-full ue:w-full ue:select-none', busy ? 'ue:cursor-wait' : 'ue:cursor-crosshair')}
      />
      {rect && rect.length === 4 && (
        <span
          className="ue:pointer-events-none ue:absolute ue:rounded-sm ue:border-2 ue:border-success"
          style={{
            left: `${rect[0] * 100}%`,
            top: `${rect[1] * 100}%`,
            width: `${rect[2] * 100}%`,
            height: `${rect[3] * 100}%`,
          }}
        />
      )}
      <span className="ue:pointer-events-none ue:absolute ue:top-1.5 ue:right-1.5 ue:flex ue:items-center ue:gap-1 ue:rounded-sm ue:bg-panel/85 ue:px-1.5 ue:py-px ue:font-mono ue:text-caption ue:text-fg">
        <Crosshair className="ue:h-3 ue:w-3" />
        {label ?? t('实时')}
      </span>
    </div>
  )
}
