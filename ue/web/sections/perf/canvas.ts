import { useEffect, useState } from 'react'

/**
 * canvas 图（帧条、时间轴）共用：量容器宽度、按设备像素比设画布、读面板主题色。
 * 时间轴一屏上万个块，SVG 画不动（设计 7），所以这两个用 canvas；颜色照样取面板主题变量，浅色深色都对。
 */

/** 盯着元素宽度：分栏拖动、窗口缩放时重画 */
export function useWidth(el: HTMLElement | null) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)))
    ro.observe(el)
    setW(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [el])
  return w
}

/** 面板切换主题（改根元素的 class / data-*）时让 canvas 重画 */
export function useThemeTick() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const mo = new MutationObserver(() => setN((x) => x + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setN((x) => x + 1)
    mq.addEventListener('change', on)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', on)
    }
  }, [])
  return n
}

export function setup(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const g = canvas.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  return g
}

export interface Theme {
  card: string
  fg: string
  muted: string
  subtle: string
  line: string
  accent: string
  danger: string
  warning: string
  success: string
  hover: string
  dark: boolean
}

let probe: CanvasRenderingContext2D | null = null
/** 主题变量可能是 oklch / hex / 变量套变量：画到 1×1 的画布上读回像素算亮度，最稳 */
function isDark(color: string) {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return false
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

export function readTheme(el: Element = document.documentElement): Theme {
  const cs = getComputedStyle(el)
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d
  const card = v('--card', '#fff')
  return {
    card,
    fg: v('--fg', '#222'),
    muted: v('--muted', '#555'),
    subtle: v('--subtle', '#888'),
    line: v('--line', '#ddd'),
    accent: v('--accent', '#d97706'),
    danger: v('--danger', '#dc2626'),
    warning: v('--warning', '#d97706'),
    success: v('--success', '#16a34a'),
    hover: v('--hover', 'rgba(0,0,0,.05)'),
    dark: isDark(card),
  }
}

/** 时间刻度：挑 1 / 2 / 5 × 10^k 秒，让相邻刻度隔约 minPx 像素 */
export function tickStep(span: number, width: number, minPx = 90) {
  const raw = (span / Math.max(width, 1)) * minPx
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}

/** 刻度文字：按步长定小数位（步长 1 毫秒就写到 0.001 秒），时间是相对 trace 开头的秒 */
export function tickLabel(s: number, step: number) {
  const digits = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)))
  return `${s.toFixed(digits)} s`
}
