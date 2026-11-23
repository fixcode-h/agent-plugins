/**
 * 日志列表的虚拟滚动布局：一条日志可能是多行（调用栈、崩溃 JSON），高度 = 行数 × 行高；
 * 只画看得见的那几条，几千条刷屏也不卡。纯函数，单测在 layout.test.ts。
 */

/** 一条最多画多少行：服务端已经把单条限在 400 行左右，这里再兜一层，免得一条撑出几万像素 */
export const MAX_ENTRY_LINES = 500

export const lineCount = (text: string) => {
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0 && n < MAX_ENTRY_LINES; i = text.indexOf('\n', i + 1)) n++
  return n
}

/** 每条的顶部位置（tops[i]）和总高度 */
export function layoutRows(rows: { text: string; mark?: boolean }[], rowH: number) {
  const tops = new Array<number>(rows.length)
  let y = 0
  rows.forEach((r, i) => {
    tops[i] = y
    y += (r.mark ? 1 : lineCount(r.text)) * rowH
  })
  return { tops, total: y }
}

/** 视口 [top, top+height] 内（前后多留 overscan 像素）的条目下标区间 [first, last) */
export function visibleRange(tops: number[], total: number, top: number, height: number, overscan: number) {
  const from = Math.max(0, top - overscan)
  const to = Math.min(total, top + height + overscan)
  // 找最后一个 tops[i] <= from 的 i（那条跨过视口上沿也要画）
  let lo = 0
  let hi = tops.length - 1
  let first = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tops[mid] <= from) {
      first = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  let last = first
  while (last < tops.length && tops[last] < to) last++
  return { first, last: Math.max(last, Math.min(first + 1, tops.length)) }
}
