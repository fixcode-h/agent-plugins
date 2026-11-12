/**
 * 填充柄：拖选区右下角的小方块，把选中的几格按规律延续下去（像 Excel / WPS）。
 * 规律按「一条线」算：往下拖时是一列里选中的几格，往右拖时是一行里选中的几格。
 *
 * 默认（不按 Ctrl）：
 * - 两格以上都是数字：按它们的步长接着递增（1、2 → 3、4；0.5、1 → 1.5、2）
 * - 只有一格数字：照样复制（ID 列常常只想复制，按住 Ctrl 才递增）
 * - 结尾带数字的文字（Icon_01、Item1）：结尾的数字 +1，保留前面补的 0
 * - 其它：几格轮流复制
 * 按住 Ctrl：数字的两种做法对调（一格数字也递增、几格数字改成轮流复制），带数字的文字改成复制。
 * 全是纯函数，算出要填的值，由页面一次提交（一次撤销）。
 */
import type { CellSet } from './table-edit.ts'

const NUM = /^-?\d+(?:\.\d+)?$/
const INT = /^-?\d+$/
/** 结尾带数字的文字：前缀 + 数字（前缀不能是纯符号「-」，那是负数） */
const TAIL = /^(.*?\D)(\d+)$/

const decimals = (s: string) => (s.includes('.') ? s.length - s.indexOf('.') - 1 : 0)

/** 一串数字的步长：等差就用公差，不等差按首尾平均（和 Excel 的趋势近似，配置表里很少见） */
function numStep(vals: string[]): { int: boolean; step: number | bigint } {
  const int = vals.every((v) => INT.test(v))
  if (int) {
    const ns = vals.map((v) => BigInt(v))
    if (ns.length < 2) return { int, step: 1n }
    const d = ns[1] - ns[0]
    if (ns.every((n, i) => i === 0 || n - ns[i - 1] === d)) return { int, step: d }
    const span = ns[ns.length - 1] - ns[0]
    const k = BigInt(ns.length - 1)
    // 首尾平均除不尽时退回小数
    if (span % k === 0n) return { int, step: span / k }
    return { int: false, step: Number(span) / Number(k) }
  }
  const ns = vals.map(Number)
  if (ns.length < 2) return { int, step: 1 }
  return { int, step: (ns[ns.length - 1] - ns[0]) / (ns.length - 1) }
}

/** 按步长从最后一格往后数 count 个 */
function numSeries(vals: string[], count: number): string[] {
  const { int, step } = numStep(vals)
  const last = vals[vals.length - 1]
  if (int && typeof step === 'bigint') {
    const base = BigInt(last)
    return Array.from({ length: count }, (_, i) => String(base + step * BigInt(i + 1)))
  }
  // 小数位按原来最多的那格走，免得 0.1 + 0.2 写成 0.30000000000000004
  const d = Math.min(10, Math.max(...vals.map(decimals), decimals(String(step))))
  const base = Number(last)
  return Array.from({ length: count }, (_, i) => (base + Number(step) * (i + 1)).toFixed(d))
}

/** 结尾数字 +n，位数不够补 0（Icon_09 → Icon_10，Icon_099 → Icon_100） */
const bump = (prefix: string, digits: string, n: bigint) => {
  const v = BigInt(digits) + n
  const s = (v < 0n ? 0n : v).toString()
  return prefix + (digits.startsWith('0') ? s.padStart(digits.length, '0') : s)
}

/**
 * 一条线上选中的几格（按拖的方向排好）往后延续 count 个值。
 * flip = 按住 Ctrl：数字的复制 / 递增对调，带数字的文字改成复制
 */
export function extendSeries(vals: string[], count: number, flip = false): string[] {
  if (count <= 0 || !vals.length) return []
  const t = vals.map((v) => v.trim())
  const cycle = () => Array.from({ length: count }, (_, i) => vals[i % vals.length])
  if (t.every((v) => NUM.test(v))) {
    const series = t.length >= 2 ? !flip : flip
    return series ? numSeries(t, count) : cycle()
  }
  if (!flip && t.every((v) => TAIL.test(v))) {
    const parts = t.map((v) => TAIL.exec(v)!)
    // 几格前缀一样、结尾是等差的数字（Lv1、Lv3）：按这个步长接着数；否则每格各自按轮数 +1
    const same = parts.every((p) => p[1] === parts[0][1])
    if (same && parts.length >= 2) {
      const nums = numSeries(
        parts.map((p) => p[2]),
        count,
      )
      // 位数照最后一格补 0（Lv01、Lv03 → Lv05）：拿同样位数的 0 当起点加上去
      const zeros = parts[parts.length - 1][2].replace(/\d/g, '0')
      return nums.map((n) => bump(parts[0][1], zeros, BigInt(n)))
    }
    return Array.from({ length: count }, (_, i) => {
      const p = parts[i % parts.length]
      // 第几轮就加几：一格时 Item1 → Item2、Item3；几格前缀不同时各自数（A1、B1 → A2、B2）
      return bump(p[1], p[2], BigInt(Math.floor(i / parts.length) + 1))
    })
  }
  return cycle()
}

export type FillDir = 'down' | 'up' | 'right' | 'left'

/**
 * 填充柄拖完：把选中的一块（rows × cols，按显示顺序）沿 dir 填进 target 那几行或几列。
 * 往下 / 往上时每列各算一条线，往右 / 往左时每行各算一条线；往上、往左时从靠近选区的一端倒着数
 */
export function fillHandle(
  grid: string[][],
  sel: { rows: number[]; cols: number[] },
  dir: FillDir,
  target: number[],
  flip = false,
): CellSet[] {
  const out: CellSet[] = []
  const at = (r: number, c: number) => grid[r]?.[c] ?? ''
  if (dir === 'down' || dir === 'up') {
    for (const c of sel.cols) {
      const line = sel.rows.map((r) => at(r, c))
      const vals = extendSeries(dir === 'down' ? line : line.reverse(), target.length, flip)
      // 往上时 target 按显示顺序从上往下，离选区近的在最后
      const tgt = dir === 'down' ? target : [...target].reverse()
      tgt.forEach((r, i) => out.push({ r, c, v: vals[i] }))
    }
  } else {
    for (const r of sel.rows) {
      const line = sel.cols.map((c) => at(r, c))
      const vals = extendSeries(dir === 'right' ? line : line.reverse(), target.length, flip)
      const tgt = dir === 'right' ? target : [...target].reverse()
      tgt.forEach((c, i) => out.push({ r, c, v: vals[i] }))
    }
  }
  return out
}
