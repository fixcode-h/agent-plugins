import type { CSSProperties } from 'react'
import type { Rect } from './approx.ts'
import { gridSpec, toScreen, type View } from './view.ts'

/**
 * 设计器上叠在画面上面的框：布局框、悬停框、选中框和名字 · 尺寸标签。
 * 都按视图换算成画布像素再画（不放进缩放的那一层），所以放大缩小时线宽和字号不变，不会变粗、变糊。
 */
export function Overlays({
  view,
  rects,
  boxes,
  hover,
  sel,
  selName,
}: {
  view: View
  rects: Rect[]
  boxes: boolean
  hover?: Rect
  sel?: Rect
  selName?: string
}) {
  const at = (r: Rect, grow = 0): CSSProperties => {
    const p = toScreen(view, r.x, r.y)
    return { left: p.x - grow, top: p.y - grow, width: r.w * view.k + grow * 2, height: r.h * view.k + grow * 2 }
  }
  return (
    <>
      {boxes &&
        rects.map((r) => (
          <span
            key={r.key}
            className="ue:pointer-events-none ue:absolute ue:border ue:border-dashed ue:border-canvas-guide/50"
            style={at(r)}
          />
        ))}
      {hover && (
        <span
          className="ue:pointer-events-none ue:absolute ue:border ue:border-accent/70 ue:bg-accent/8"
          style={at(hover)}
        />
      )}
      {sel && (
        <span className="ue:pointer-events-none ue:absolute ue:border-2 ue:border-accent" style={at(sel, 1)}>
          <span className="ue:absolute ue:-top-5 ue:left-[-2px] ue:rounded-t-[3px] ue:bg-accent ue:px-1.5 ue:font-mono ue:text-caption ue:whitespace-nowrap ue:text-on-accent">
            {selName} · {Math.round(sel.w)}×{Math.round(sel.h)}
          </span>
        </span>
      )}
    </>
  )
}

/**
 * 网格底（照 UE 设计器）：细线一层、粗线一层，原点对齐设计稿左上角，平移时网格跟着动。
 * 颜色取主题里画布的线色，深浅色都跟着走。
 */
export function gridStyle(view: View): CSSProperties {
  const { minor, major } = gridSpec(view.k)
  const line = (c: string, angle: 0 | 90) => `linear-gradient(${angle}deg, ${c} 1px, transparent 1px)`
  const fine = 'color-mix(in srgb, var(--canvas-line) 45%, transparent)'
  const bold = 'var(--canvas-line)'
  const pos = `${view.x}px ${view.y}px`
  return {
    backgroundImage: [line(bold, 0), line(bold, 90), line(fine, 0), line(fine, 90)].join(', '),
    backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
    backgroundPosition: [pos, pos, pos, pos].join(', '),
  }
}
