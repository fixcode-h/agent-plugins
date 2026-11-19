import { memo, type CSSProperties } from 'react'
import type { Rect } from './approx.ts'
import { isHidden, type WNode } from './model.ts'
import { paintOf, transformOf } from './paint.ts'

/**
 * 近似预览的画面（设计稿 U4）：按 approx.ts 排出的矩形，一个控件一个绝对定位的块，嵌套着画（父控件的渲染变换、不透明度带着子控件走，
 * 动画拖播放头时整块平移、淡入淡出和 UE 里一样）。底色、圆角、文字照属性画，贴图和子界面画斜线占位。
 * 坐标是屏幕像素（外面整体缩放），颜色来自配置本身，不是面板主题色。
 */
const HATCH = 'repeating-linear-gradient(135deg, rgba(128,128,128,0.18) 0 6px, rgba(128,128,128,0.06) 6px 12px)'

function Block({
  n,
  rects,
  ox,
  oy,
  anims,
}: {
  n: WNode
  rects: Map<string, Rect>
  ox: number
  oy: number
  anims: Map<string, Record<string, unknown>>
}) {
  const r = rects.get(n.key)
  if (!r) return null
  const p = paintOf(n)
  const tf = transformOf(n, anims.get(n.key))
  const style: CSSProperties = {
    position: 'absolute',
    left: r.x - ox,
    top: r.y - oy,
    width: r.w,
    height: r.h,
    background: p.image ? (p.fill ? `${HATCH}, ${p.fill}` : HATCH) : p.fill,
    borderRadius: p.radius,
    transform: tf.transform,
    transformOrigin: 'center',
    opacity: tf.opacity,
    visibility: isHidden(n) ? 'hidden' : undefined,
    overflow: n.cls === 'ScrollBox' ? 'hidden' : undefined,
  }
  return (
    <div style={style}>
      {p.text !== undefined && (
        <span
          style={{
            display: 'block',
            fontSize: p.fontSize,
            lineHeight: 1.3,
            fontWeight: p.bold ? 700 : 400,
            color: p.color,
            whiteSpace: p.wrap ? 'pre-wrap' : 'pre',
            textAlign: p.justify,
            overflow: 'hidden',
          }}
        >
          {p.text}
        </span>
      )}
      {p.percent !== undefined && (
        <span style={{ position: 'absolute', inset: 0, width: `${p.percent * 100}%`, background: p.barColor }} />
      )}
      {n.children.map((c) => (
        <Block key={c.key} n={c} rects={rects} ox={r.x} oy={r.y} anims={anims} />
      ))}
    </div>
  )
}

export const ApproxCanvas = memo(function ApproxCanvas({
  tree,
  rects,
  anims,
}: {
  tree: WNode
  rects: Map<string, Rect>
  /** 这一刻动画的值：控件 key → 通道 → 值 */
  anims: Map<string, Record<string, unknown>>
}) {
  return <Block n={tree} rects={rects} ox={0} oy={0} anims={anims} />
})
