/**
 * 跨表搜索和批量替换的匹配规则：表格页左栏「内容」搜索、全部替换、Agent 的 table.search 共用一份。
 * 查询可以写成「字段名:值」只在叫这个名字的列里找；三个开关（区分大小写 / 整格 / 正则）和表格里的查找替换一样。
 */
import { z } from 'zod'
import { t } from './i18n.ts'
import { findRe } from './table-tools.ts'

export const TableSearchOpts = z.object({
  q: z.string().max(500),
  /** 区分大小写 */
  caseSensitive: z.boolean().optional(),
  /** 整格匹配：格子（数组列里的某一项也算）和要找的完全一样 */
  whole: z.boolean().optional(),
  /** 按正则找（替换里可以用 $1） */
  regex: z.boolean().optional(),
})
export type TableSearchOpts = z.infer<typeof TableSearchOpts>

/**
 * 「字段名:值」：冒号前像个字段名（字母、汉字、下划线开头，不含空格）才算，
 * 这样「12:30」「C:\\」这类本身带冒号的值照常整串找。全角冒号也认
 */
const FIELD_Q = /^([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff.]*)\s*[:：]\s*(.*)$/s

export interface ParsedQuery {
  /** 只在这一列里找（字段名，比的时候不分大小写） */
  field?: string
  /** 要找的字 */
  text: string
}

export function parseSearchQuery(q: string): ParsedQuery {
  const s = q.trim()
  const m = FIELD_Q.exec(s)
  // 只写了「字段名:」没写值时还按整串找，免得输到一半就把结果清空
  if (m && m[2].trim()) return { field: m[1], text: m[2].trim() }
  return { text: s }
}

/** 一处命中在格子文字里的位置 */
export type MatchAt = [start: number, end: number]

export interface CellMatcher {
  /** 格子里命中的第一处；没命中返回 null */
  find: (v: string) => MatchAt | null
  /** 把格子里命中的部分换成 replace；整格模式下数组列只换命中的那一项 */
  replace: (v: string, replace: string) => string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 按开关编出匹配器。写错的正则抛出原因（给用户看）。
 * listSep：整格模式下，用这个分隔符拆开的数组列（1001;1002）里某一项整项相同也算命中
 */
export function cellMatcher(text: string, o: Omit<TableSearchOpts, 'q'>, listSep = ';'): CellMatcher {
  if (!text) throw new Error(t('没有要找的内容'))
  let re: RegExp
  try {
    re = findRe(text, o)
  } catch (e) {
    throw new Error(t('正则写得不对：{err}', { err: (e as Error).message }))
  }
  // 拆数组项用：找的字本身含分隔符时不拆（整串比）
  const sep = o.whole && listSep && !text.includes(listSep) ? listSep : ''
  const item = sep ? new RegExp(o.regex ? `^(?:${text})$` : `^${escape(text)}$`, o.caseSensitive ? '' : 'i') : null
  // 不是正则、也不分大小写的子串找最常用：直接比小写，不走正则
  const lower = !o.regex && !o.whole && !o.caseSensitive ? text.toLowerCase() : ''
  const find = (v: string): MatchAt | null => {
    if (!v) return null
    if (lower) {
      const i = v.toLowerCase().indexOf(lower)
      return i < 0 ? null : [i, i + text.length]
    }
    re.lastIndex = 0
    const m = re.exec(v)
    if (m && m[0].length) return [m.index, m.index + m[0].length]
    if (!item || !v.includes(sep)) return null
    // 数组列：逐项整项比
    let at = 0
    for (const part of v.split(sep)) {
      const p = part.trim()
      if (p && item.test(p)) {
        const s = at + part.indexOf(p)
        return [s, s + p.length]
      }
      at += part.length + sep.length
    }
    return null
  }
  const replace = (v: string, to: string): string => {
    if (!v) return v
    re.lastIndex = 0
    if (re.test(v)) {
      re.lastIndex = 0
      return o.regex ? v.replace(re, to) : v.replace(re, () => to)
    }
    if (!item || !v.includes(sep)) return v
    return v
      .split(sep)
      .map((part) => {
        const p = part.trim()
        if (!p || !item.test(p)) return part
        return part.replace(p, o.regex ? p.replace(item, to) : to)
      })
      .join(sep)
  }
  return { find, replace }
}

/** 给结果列表看的一小段：命中在很后面时从前面截掉，让命中的部分露出来；at 换成在这一段里的位置 */
export function hitSnippet(v: string, at: MatchAt, max = 200): { text: string; at: MatchAt } {
  if (v.length <= max) return { text: v, at }
  const from = Math.max(0, Math.min(at[0] - 40, v.length - max))
  const head = from > 0 ? '…' : ''
  const body = v.slice(from, from + max)
  const tail = from + max < v.length ? '…' : ''
  const shift = from - head.length
  return { text: head + body + tail, at: [at[0] - shift, Math.min(at[1] - shift, head.length + body.length)] }
}

/** 字段名比较：不分大小写、去首尾空格 */
export const sameField = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// ---------- 跨表批量替换的接口（server/tables/bulk-replace.ts） ----------

export const TableReplaceBody = TableSearchOpts.extend({
  replace: z.string().max(32_767),
  /** false 只预览 */
  apply: z.boolean().default(false),
  /** 写哪些文件：路径 → 预览时的修改时间（对不上就不写这个文件） */
  files: z.record(z.string().max(600), z.string().max(40)).optional(),
})
export type TableReplaceBody = z.infer<typeof TableReplaceBody>

export interface ReplaceFile {
  path: string
  /** 预览时文件的修改时间：写的时候带回来 */
  mtime: string
  cells: number
  /** 前几处：哪一格、改前、改后 */
  samples: { sheet: string; row: number; col: number; field?: string; old: string; next: string }[]
  /** 替换后有几处不符合表格结构（保存前检查是「提醒」时只提醒） */
  problems?: number
  /** 这个文件写不了，原因 */
  blocked?: string
}

export interface ReplaceResult {
  files: ReplaceFile[]
  /** 写的时候失败的文件和原因（只在 apply 时有） */
  failed: { path: string; error: string }[]
  applied: boolean
  /** 按「字段名:值」只在这一列里替换了 */
  field?: string
  /** 写了「字段名:值」但没有哪张表有这个字段：改成按整串找了 */
  fieldMissing?: string
}
