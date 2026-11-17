import type { OcrBox } from './pipeline.ts'

/**
 * 从一张录制截图的 OCR 结果里挑「被点的那个按钮的名字」（设计稿第 3 节）：
 * 截图除了红框里的控件，还带着外扩出来的邻居（旁边的按钮、背包格子上的数字），全拿来当名字就错了。
 * 1. 只留中心落在红框（shotBox）里的段；
 * 2. 去掉置信度低于 0.6、纯符号或纯数字以外只有一个字的段；
 * 3. 同一行挨着的段拼起来（「领取」「奖励」被检测成两段时），按离框中心近、字大、置信度高打分取最高；
 * 4. 一段不剩就不给，宁缺毋滥。
 */
export const MIN_SCORE = 0.6

type Box = [number, number, number, number]

const center = (b: Box) => [b[0] + b[2] / 2, b[1] + b[3] / 2] as const
const inside = ([x, y]: readonly [number, number], b: Box) =>
  x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]

/** 只有标点、符号、空白的不要；单个字（非数字）的不要：多半是图标上的角标或箭头被认成字 */
export function meaningful(text: string) {
  const s = text.trim()
  if (!/[\p{L}\p{N}]/u.test(s)) return false
  if ([...s].length === 1 && !/\p{N}/u.test(s)) return false
  return true
}

/** 同一行挨着的段拼成一段：竖直方向大半重叠、水平间隔不超过一个字高 */
function joinLines(items: OcrBox[]): OcrBox[] {
  const sorted = [...items].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
  const lines: OcrBox[] = []
  for (const it of sorted) {
    const prev = lines.find((l) => {
      const top = Math.max(l.box[1], it.box[1])
      const bottom = Math.min(l.box[1] + l.box[3], it.box[1] + it.box[3])
      const overlap = (bottom - top) / Math.min(l.box[3], it.box[3])
      const gap = it.box[0] - (l.box[0] + l.box[2])
      return overlap > 0.6 && gap > -it.box[3] / 2 && gap < Math.max(l.box[3], it.box[3])
    })
    if (!prev) {
      lines.push({ ...it, box: [...it.box] as Box })
      continue
    }
    const x0 = Math.min(prev.box[0], it.box[0])
    const y0 = Math.min(prev.box[1], it.box[1])
    const x1 = Math.max(prev.box[0] + prev.box[2], it.box[0] + it.box[2])
    const y1 = Math.max(prev.box[1] + prev.box[3], it.box[1] + it.box[3])
    const n1 = [...prev.text].length
    const n2 = [...it.text].length
    // 中文之间不加空格，两边都是拉丁字母或数字时才隔一个空格
    const sep = /[A-Za-z0-9]$/.test(prev.text) && /^[A-Za-z0-9]/.test(it.text) ? ' ' : ''
    prev.text = prev.box[0] <= it.box[0] ? prev.text + sep + it.text : it.text + sep + prev.text
    prev.score = (prev.score * n1 + it.score * n2) / (n1 + n2)
    prev.box = [x0, y0, x1 - x0, y1 - y0]
  }
  return lines
}

export function pickLabel(items: OcrBox[], shotBox: Box | undefined): string | undefined {
  // 没有红框（点在游戏画面上）：不知道哪段是目标，不猜
  if (!shotBox || shotBox[2] <= 0 || shotBox[3] <= 0) return undefined
  const kept = items.filter((it) => it.score >= MIN_SCORE && meaningful(it.text) && inside(center(it.box), shotBox))
  if (!kept.length) return undefined
  const [cx, cy] = center(shotBox)
  const diag = Math.hypot(shotBox[2], shotBox[3]) || 1
  let best: OcrBox | undefined
  let bestScore = -Infinity
  for (const it of joinLines(kept)) {
    const [x, y] = center(it.box)
    const near = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / (diag / 2))
    const size = Math.min(1, it.box[3] / Math.max(12, shotBox[3] * 0.6))
    const s = near * 0.45 + size * 0.35 + it.score * 0.2
    if (s > bestScore) {
      bestScore = s
      best = it
    }
  }
  return best?.text.replace(/\s+/g, ' ').trim() || undefined
}
