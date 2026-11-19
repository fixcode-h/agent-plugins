import { structOf } from './approx.ts'
import type { WNode } from './model.ts'

/**
 * 近似预览里一个控件画成什么样：底色、圆角、文字、字号、文字颜色、是不是贴图（画斜线占位）。
 * 颜色是 UE 的线性色 {R,G,B,A}（或 FSlateColor 的 SpecifiedColor、"(R=…)" 文本），转成 sRGB 给 CSS。纯函数。
 */
export interface Paint {
  fill?: string
  radius?: number
  text?: string
  fontSize?: number
  color?: string
  bold?: boolean
  wrap?: boolean
  justify?: 'left' | 'center' | 'right'
  /** 贴图、材质画不出来：画斜线占位 */
  image?: boolean
  /** 进度条的填充比例和颜色 */
  percent?: number
  barColor?: string
}

const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** 线性色 → sRGB 0–255 */
const toSrgb = (c: number) => {
  const x = Math.max(0, Math.min(1, c))
  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
}

/** {R,G,B,A}、{SpecifiedColor:{…}}、"(R=1,G=0,B=0,A=1)" → rgba()；读不出返回 undefined */
export function cssColor(v: unknown, tint?: unknown): string | undefined {
  const o = obj(v)
  const c = structOf(o && 'SpecifiedColor' in o ? o.SpecifiedColor : v)
  if (!c || typeof c.R !== 'number') return undefined
  const t = structOf(obj(tint) && 'SpecifiedColor' in obj(tint)! ? obj(tint)!.SpecifiedColor : tint)
  const m = (k: 'R' | 'G' | 'B' | 'A') => Number(c[k] ?? 1) * Number(t?.[k] ?? 1)
  return `rgba(${toSrgb(m('R'))}, ${toSrgb(m('G'))}, ${toSrgb(m('B'))}, ${Math.max(0, Math.min(1, m('A')))})`
}

function brushPaint(brush: unknown, tint?: unknown): Pick<Paint, 'fill' | 'radius' | 'image'> {
  const b = obj(brush) ?? {}
  const outline = obj(b.OutlineSettings)
  const radii = structOf(outline?.CornerRadii)
  const rounded = /Rounded/i.test(String(b.DrawAs ?? ''))
  return {
    fill: cssColor(b.TintColor ?? { R: 1, G: 1, B: 1, A: 1 }, tint),
    radius: rounded ? Number(radii?.X ?? 0) || undefined : undefined,
    image: !!b.ResourceObject || !!b.Texture,
  }
}

export function paintOf(n: WNode): Paint {
  const p = n.props ?? {}
  switch (n.cls) {
    case 'Border':
      return brushPaint(p.Background, p.BrushColor)
    case 'Image':
      return brushPaint(p.Brush, p.ColorAndOpacity)
    case 'Button': {
      const style = obj(p.WidgetStyle)
      return {
        ...brushPaint(style?.Normal ?? { TintColor: { R: 0.6, G: 0.6, B: 0.6, A: 1 } }, p.BackgroundColor),
        image: false,
      }
    }
    case 'TextBlock':
    case 'RichTextBlock': {
      const font = obj(p.Font)
      const j = String(p.Justification ?? '')
      return {
        text: String(p.Text ?? ''),
        fontSize: Number(font?.Size ?? 24),
        bold: /bold|black|heavy/i.test(String(font?.TypefaceFontName ?? '')),
        color: cssColor(p.ColorAndOpacity) ?? 'rgb(255, 255, 255)',
        wrap: p.AutoWrapText === true,
        justify: /Center/i.test(j) ? 'center' : /Right/i.test(j) ? 'right' : 'left',
      }
    }
    case 'ProgressBar':
      return {
        fill: 'rgba(255, 255, 255, 0.12)',
        percent: Math.max(0, Math.min(1, Number(p.Percent ?? 0))),
        barColor: cssColor(p.FillColorAndOpacity) ?? 'rgb(0, 112, 224)',
      }
    case 'EditableText':
    case 'EditableTextBox':
      return {
        fill: 'rgba(255, 255, 255, 0.9)',
        text: String(p.HintText ?? p.Text ?? ''),
        color: 'rgb(60, 60, 60)',
        fontSize: 16,
      }
    default:
      return n.user || n.cls === 'UserWidget' ? { image: true } : {}
  }
}

/** 控件自己的渲染变换和不透明度（静态属性和动画这一刻的值合在一起，动画的覆盖属性里写的） */
export function transformOf(n: WNode, anim?: Record<string, unknown>) {
  const p = n.props ?? {}
  const rt = obj(p.RenderTransform) ?? {}
  const tr = structOf(rt.Translation) ?? {}
  const sc = structOf(rt.Scale) ?? {}
  const pick = (ch: string, base: unknown, d: number) => {
    const v = anim?.[ch] ?? base
    return typeof v === 'number' ? v : d
  }
  const tx = pick('RenderTransform.Translation.X', tr.X, 0)
  const ty = pick('RenderTransform.Translation.Y', tr.Y, 0)
  const sx = pick('RenderTransform.Scale.X', sc.X, 1)
  const sy = pick('RenderTransform.Scale.Y', sc.Y, 1)
  const angle = pick('RenderTransform.Angle', rt.Angle, 0)
  const opacity = pick('RenderOpacity', p.RenderOpacity, 1)
  const ident = !tx && !ty && sx === 1 && sy === 1 && !angle
  return {
    transform: ident ? undefined : `translate(${tx}px, ${ty}px) rotate(${angle}deg) scale(${sx}, ${sy})`,
    opacity: opacity === 1 ? undefined : opacity,
  }
}
