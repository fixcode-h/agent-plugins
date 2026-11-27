import { getAt, parsePath, slotsOf, type GtStep } from '../../../../shared/gt-script/index.ts'

/**
 * 场景详情页的步骤行：把场景摊成一行一行，块里的步骤（录完装成的录制段、如果、循环）也各占一行。
 * 一行按路径认（`steps.3`、`steps.1.do.0`），不按平铺序号：录制段里的第 1 步和顶层第 1 步是两行。
 * 逐步工具（换标识、跳过条件、截图认字、步骤历史、插入删除）都拿行上的 slot + i 改文件（ext/gt/file 的 slot）
 */

/** 运行从哪儿开始，用来把结果对回行：0 整份场景；n 从顶层第 n 步起的临时运行；字符串是「只跑这一步」那一步的路径 */
export type RunBase = number | string

/** 一条结果里认行用到的字段（GameTest 1.9.0 起有 path，块结束记一条 block） */
export interface ResultLike {
  index: number
  path?: string
  setup?: boolean
  /** 收尾段的记录（GameTest 2.7.0）：path 是 teardown.N，不对到主流程的行 */
  teardown?: boolean
  /** 在哪个 call 里跑的（GameTest 2.8.0） */
  calls?: string[]
}

export interface RowPlace {
  /** 在所在槽里的第几步（0 起） */
  i: number
  /** 完整路径：行的唯一键 */
  key: string
  /** 所在槽（数组）的路径 */
  slot: string
  /** 显示的序号：顶层「4」，块里「2.3」 */
  no: string
  /** 缩进层数：顶层 0 */
  depth: number
  /** 这一步是块（有子步骤） */
  block?: boolean
}

/** 场景里的全部步骤，按显示顺序摊平（块行在前，里面的步骤跟在后面）。一个块的几个槽（那么 / 否则）接着数序号 */
export function placeRows<T extends Record<string, unknown>>(steps: T[]): (RowPlace & { def: T })[] {
  const out: (RowPlace & { def: T })[] = []
  const visit = (items: unknown[], slot: string, depth: number, noOf: (i: number) => string) =>
    items.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const def = raw as T
      const key = `${slot}.${i}`
      const no = noOf(i)
      const refs = typeof def.action === 'string' ? slotsOf(def as unknown as GtStep) : []
      out.push({ i, key, slot, no, depth, block: refs.length > 0 || undefined, def })
      // 同一块的几个槽接着数：「那么」1、2，「否则」接 3，序号在这一块里不重
      let n = 0
      for (const r of refs) {
        const arr = getAt(def, r.key)
        if (!Array.isArray(arr)) continue
        const from = n
        visit(arr, `${key}.${r.key.join('.')}`, depth + 1, (k) => `${no}.${from + k + 1}`)
        n += arr.length
      }
    })
  visit(steps, 'steps', 0, (i) => String(i + 1))
  return out
}

/**
 * 一条结果对到哪一行（行的 key）。有 path（GameTest 1.9.0 起）按路径，否则按顶层序号。
 * 临时运行的脚本是从原场景里截出来的：从顶层第 n 步起跑的，结果路径的顶层序号加 n；只跑一步的，结果的 steps.0 换成那一步的路径
 */
export function resultKey(r: ResultLike, base: RunBase = 0): string | undefined {
  // 子脚本里的记录（calls，GameTest 2.8.0）路径相对子脚本，对不到这份脚本的行
  if (r.setup || r.teardown || r.path?.startsWith('teardown') || r.calls?.length) return undefined
  const path = r.path && /^steps\.\d+/.test(r.path) ? r.path : `steps.${r.index}`
  const m = /^steps\.(\d+)(.*)$/.exec(path)!
  if (typeof base === 'string') return `${base}${m[2]}`
  return `steps.${Number(m[1]) + base}${m[2]}`
}

/** 「只跑这一步」「从这一步开始运行」时这一步在不在块里（在块里的要按路径跑） */
export const nested = (key: string) => parsePath(key).length > 2

/**
 * 「从这一步开始运行」时的起点：顶层的步骤给序号（旧 GameTest 也能跑截出来的步骤），块里的给路径（gt.run 的 from，GameTest 1.9.0）
 */
export const runStart = (key: string): { index: number } | { from: string } =>
  nested(key) ? { from: key } : { index: Number(parsePath(key)[1]) }

/** 同一个槽里第 k 步的显示序号：从这一步的序号推（块里接着数的槽不从 1 开始） */
export function numOf(at: { i: number; no: string }) {
  const parts = at.no.split('.')
  const last = Number(parts.pop())
  const prefix = parts.join('.')
  const start = Number.isFinite(last) ? last - 1 - at.i : 0
  return (k: number) => (prefix ? `${prefix}.${start + k + 1}` : String(start + k + 1))
}
