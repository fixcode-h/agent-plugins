/**
 * 设计器画布的视图变换（用户 2026-11-20：中间允许放大缩小，右键整体拖拽位置观察细节，完全参考 UE）。
 * 纯函数，不碰 DOM，单测在 view.test.ts。
 * 视图 = 缩放 k + 设计坐标原点在画布（舞台元素）里的像素位置 (x, y)：屏幕 = 设计 × k + 原点。
 */
export interface View {
  k: number
  x: number
  y: number
}

/**
 * 缩放档位：照 UE 控件蓝图设计器（SDesignSurface 的固定档位）的比例写法，1:1 是原大。
 * 比 1:10 更小、10:1 更大的不给：太小看不出东西，太大一个像素占满屏也没意义。
 */
export const ZOOM_LEVELS: { k: number; label: string }[] = [
  [0.1, '1:10'],
  [0.125, '1:8'],
  [0.25, '1:4'],
  [0.375, '3:8'],
  [0.5, '1:2'],
  [0.625, '5:8'],
  [0.75, '3:4'],
  [0.875, '7:8'],
  [1, '1:1'],
  [1.25, '5:4'],
  [1.5, '3:2'],
  [1.75, '7:4'],
  [2, '2:1'],
  [2.5, '5:2'],
  [3, '3:1'],
  [3.5, '7:2'],
  [4, '4:1'],
  [5, '5:1'],
  [6, '6:1'],
  [7, '7:1'],
  [8, '8:1'],
  [9, '9:1'],
  [10, '10:1'],
].map(([k, label]) => ({ k: k as number, label: label as string }))

export const ZOOM_MIN = ZOOM_LEVELS[0].k
export const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1].k

const EPS = 1e-6

export const clampZoom = (k: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k))

/**
 * 滚一格后的缩放：dir > 0 放大到下一档，< 0 缩小到上一档。
 * 「适应」算出来的缩放常落在两档之间，这时先吸到相邻的那一档（UE 也是这样），不会跳过一档。
 */
export function stepZoom(k: number, dir: number): number {
  if (dir > 0) return (ZOOM_LEVELS.find((z) => z.k > k + EPS) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).k
  if (dir < 0) return ([...ZOOM_LEVELS].reverse().find((z) => z.k < k - EPS) ?? ZOOM_LEVELS[0]).k
  return k
}

/** 状态栏上的缩放文字：正好是一档时用 UE 的比例写法（1:2），否则（适应屏幕算出来的）写百分比 */
export function zoomLabel(k: number): string {
  const z = ZOOM_LEVELS.find((l) => Math.abs(l.k - k) < EPS)
  return z ? z.label : `${Math.round(k * 100)}%`
}

/** 画布像素 → 设计坐标（悬停、点选用；sx / sy 相对舞台左上角） */
export const toDesign = (v: View, sx: number, sy: number) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k })

/** 设计坐标 → 画布像素 */
export const toScreen = (v: View, dx: number, dy: number) => ({ x: dx * v.k + v.x, y: dy * v.k + v.y })

/** 以画布上的 (cx, cy) 为中心换到缩放 k：光标下那一点的设计坐标缩放前后不动 */
export function zoomAt(v: View, k: number, cx: number, cy: number): View {
  const nk = clampZoom(k)
  const d = toDesign(v, cx, cy)
  return { k: nk, x: cx - d.x * nk, y: cy - d.y * nk }
}

/** 缩放到适合：整张设计稿放进画布并居中，四周留 pad 像素；画布太小时也不小于最小档 */
export function fitView(room: { w: number; h: number }, size: { w: number; h: number }, pad = 32): View {
  const k = clampZoom(Math.min((room.w - pad * 2) / size.w, (room.h - pad * 2) / size.h))
  return { k, x: (room.w - size.w * k) / 2, y: (room.h - size.h * k) / 2 }
}

/** 1:1：以画布中心为中心换到原大（工具栏按钮用；滚轮是以光标为中心） */
export const actualSize = (v: View, room: { w: number; h: number }) => zoomAt(v, 1, room.w / 2, room.h / 2)

/**
 * 平移的边界：设计稿至少留 keep 像素在画布里，拖不丢（UE 里拖远了得按 Home 找回来，这里干脆不让拖丢）。
 */
export function clampPan(v: View, room: { w: number; h: number }, size: { w: number; h: number }, keep = 48): View {
  const w = size.w * v.k
  const h = size.h * v.k
  const kx = Math.min(keep, w)
  const ky = Math.min(keep, h)
  return {
    k: v.k,
    x: Math.max(kx - w, Math.min(room.w - kx, v.x)),
    y: Math.max(ky - h, Math.min(room.h - ky, v.y)),
  }
}

/**
 * 网格底（照 UE 设计器）：细线和粗线的间距（画布像素）。设计坐标上细线 8 单位、粗线 8 格；
 * 缩小到细线挤在一起（小于 6 像素）时成倍放宽，不糊成一片。
 */
export function gridSpec(k: number): { minor: number; major: number } {
  let cell = 8
  while (cell * k < 6) cell *= 2
  return { minor: cell * k, major: cell * 8 * k }
}

/**
 * 滚轮换算成档：鼠标滚一格（deltaY 几十到上百）换一档，和 UE 一样一格一档；
 * 触控板一次只给几像素，攒够 50 再换一档，不会一抹到底。返回要走的档数（正数放大，向上滚是放大）和剩下的累计量。
 * deltaMode 1（按行，Firefox）按一行 33 像素算，2（按页）按 400。
 */
export function wheelSteps(acc: number, deltaY: number, deltaMode = 0): { steps: number; acc: number } {
  const d = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY
  if (Math.abs(d) >= 50) return { steps: d < 0 ? 1 : -1, acc: 0 }
  // 换了方向就从头攒，免得反着滚第一下没反应
  const total = (Math.sign(acc) === Math.sign(d) ? 0 : acc) - d
  const steps = Math.trunc(total / 50)
  return { steps, acc: total - steps * 50 }
}
