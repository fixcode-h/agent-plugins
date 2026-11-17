import type { RgbaImage } from './png.ts'

/**
 * PP-OCRv5 的前后处理（检测 → 裁剪 → 识别 → CTC 解码），参数照 PaddleOCR 的默认值。
 * 不直接依赖 onnxruntime：推理由 `OcrRunner` 传进来（engine.ts 从数据目录加载运行时），这里只做纯计算，单测不用装运行时。
 * 只认横排文字：游戏 UI 的按钮名、标签都是横排，检测框按轴对齐矩形处理，省掉旋转框的计算。
 */
export interface Tensor {
  data: Float32Array
  dims: readonly number[]
}

export interface OcrRunner {
  /** 检测模型：输入 [1,3,H,W]，输出 [1,1,H,W] 的文字概率图 */
  det(input: Tensor): Promise<Tensor>
  /** 识别模型：输入 [1,3,48,W]，输出 [1,T,字表长度] */
  rec(input: Tensor): Promise<Tensor>
}

export interface OcrBox {
  /** 在原图上的像素框 [x, y, w, h] */
  box: [number, number, number, number]
  text: string
  /** 识别置信度（0–1，各字概率的平均） */
  score: number
}

const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD = [0.229, 0.224, 0.225]
const DET_THRESH = 0.3
const BOX_THRESH = 0.6
const UNCLIP = 1.5
/** 小截图放大到短边这么长再检测：录制截图常只有两三百像素，原尺寸下小字检不出来 */
const DET_MIN_SIDE = 640
const DET_MAX_SIDE = 1600
const REC_H = 48
const REC_MIN_W = 320
const REC_MAX_W = 1600

/** 双线性缩放出 RGB 浮点（0–255），给前处理用 */
function resizeRgb(
  img: RgbaImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh * 3)
  const { width, height, data } = img
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(Math.max(sy + ((y + 0.5) * sh) / dh - 0.5, 0), height - 1)
    const y0 = Math.floor(fy)
    const y1 = Math.min(y0 + 1, height - 1)
    const wy = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(Math.max(sx + ((x + 0.5) * sw) / dw - 0.5, 0), width - 1)
      const x0 = Math.floor(fx)
      const x1 = Math.min(x0 + 1, width - 1)
      const wx = fx - x0
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * width + x0) * 4 + c]
        const b = data[(y0 * width + x1) * 4 + c]
        const d = data[(y1 * width + x0) * 4 + c]
        const e = data[(y1 * width + x1) * 4 + c]
        out[(y * dw + x) * 3 + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy
      }
    }
  }
  return out
}

/** 检测输入的尺寸：短边放大到 DET_MIN_SIDE、长边不超过 DET_MAX_SIDE，都取 32 的倍数 */
export function detSize(w: number, h: number): [number, number] {
  let scale = Math.max(1, DET_MIN_SIDE / Math.min(w, h))
  scale = Math.min(scale, DET_MAX_SIDE / Math.max(w, h))
  const r = (v: number) => Math.max(32, Math.round((v * scale) / 32) * 32)
  return [r(w), r(h)]
}

export function detInput(img: RgbaImage): { tensor: Tensor; w: number; h: number } {
  const [w, h] = detSize(img.width, img.height)
  const rgb = resizeRgb(img, 0, 0, img.width, img.height, w, h)
  const data = new Float32Array(3 * w * h)
  // 模型按 BGR 训练：通道 0 放 B
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const src = rgb[i * 3 + (2 - c)] / 255
      data[c * w * h + i] = (src - DET_MEAN[c]) / DET_STD[c]
    }
  }
  return { tensor: { data, dims: [1, 3, h, w] }, w, h }
}

/** 概率图 → 文字框（检测图坐标）：连通域 + 框内平均概率过滤 + 按面积/周长外扩 */
export function detBoxes(prob: Float32Array, w: number, h: number): [number, number, number, number][] {
  const seen = new Uint8Array(w * h)
  const boxes: [number, number, number, number][] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || prob[start] <= DET_THRESH) continue
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let sum = 0
    let n = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w
      const y = (p - x) / w
      sum += prob[p]
      n++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of next) {
        if (q >= 0 && !seen[q] && prob[q] > DET_THRESH) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    if (Math.min(bw, bh) < 3 || sum / n < BOX_THRESH) continue
    const d = (bw * bh * UNCLIP) / (2 * (bw + bh))
    const x0 = Math.max(0, minX - d)
    const y0 = Math.max(0, minY - d)
    const x1 = Math.min(w, maxX + 1 + d)
    const y1 = Math.min(h, maxY + 1 + d)
    boxes.push([x0, y0, x1 - x0, y1 - y0])
  }
  return boxes
}

export function recInput(img: RgbaImage, box: [number, number, number, number]): Tensor {
  const [bx, by, bw, bh] = box
  const fitW = Math.min(REC_MAX_W, Math.max(1, Math.ceil((REC_H * bw) / bh)))
  const outW = Math.max(REC_MIN_W, fitW)
  const rgb = resizeRgb(img, bx, by, bw, bh, fitW, REC_H)
  // 右边补 0（归一化后的 0），和 PaddleOCR 的 resize_norm_img 一样
  const data = new Float32Array(3 * REC_H * outW)
  for (let y = 0; y < REC_H; y++) {
    for (let x = 0; x < fitW; x++) {
      for (let c = 0; c < 3; c++) {
        const src = rgb[(y * fitW + x) * 3 + (2 - c)] / 255
        data[c * REC_H * outW + y * outW + x] = (src - 0.5) / 0.5
      }
    }
  }
  return { data, dims: [1, 3, REC_H, outW] }
}

/** CTC 贪心解码：下标 0 是 blank，字表之后多一个空格 */
export function ctcDecode(out: Tensor, dict: readonly string[]): { text: string; score: number } {
  const [, steps, classes] = out.dims
  let text = ''
  let total = 0
  let count = 0
  let last = 0
  for (let t = 0; t < steps; t++) {
    let best = 0
    let bestP = -Infinity
    const base = t * classes
    for (let k = 0; k < classes; k++) {
      const p = out.data[base + k]
      if (p > bestP) {
        bestP = p
        best = k
      }
    }
    if (best !== 0 && best !== last) {
      text += best - 1 < dict.length ? dict[best - 1] : ' '
      total += bestP
      count++
    }
    last = best
  }
  return { text: text.trim(), score: count ? total / count : 0 }
}

export async function recognize(img: RgbaImage, runner: OcrRunner, dict: readonly string[]): Promise<OcrBox[]> {
  const det = detInput(img)
  const prob = await runner.det(det.tensor)
  const sx = img.width / det.w
  const sy = img.height / det.h
  const result: OcrBox[] = []
  for (const [x, y, w, h] of detBoxes(prob.data, det.w, det.h)) {
    const box: [number, number, number, number] = [x * sx, y * sy, w * sx, h * sy]
    if (box[2] < 2 || box[3] < 2) continue
    const { text, score } = ctcDecode(await runner.rec(recInput(img, box)), dict)
    if (text) result.push({ box: box.map((v) => Math.round(v)) as OcrBox['box'], text, score })
  }
  return result
}
