/**
 * 项目的表头配置：表头是一个「行」的数组，数组里每一项对应表格表头的一行，按顺序从 start 那行往下排，
 * 能加、能删、能挪；每行配置是什么（kind，决定底色和用途：字段名当列标题、类型参与检查……）、
 * 叫什么（label）、能填什么（values，通用枚举名或 TYPE_NAMES）。
 * 表格页完全按这份配置显示，不再按内容猜（用户 2026-11-12 定）；配置存在表格结构文件里，表格文件不动。
 *
 * 面板的表格组件（SheetTable、SheetHeaderBar）认的是 SheetHeader（start + roles + labels），这里负责来回换。
 */
import { z } from 'zod'
import { SHEET_ROLES, type SheetHeader, type SheetRole } from './sheet-header.ts'

/** 表头最多这么多行：配置表的表头不会更长 */
export const HEADER_MAX_ROWS = 20

/** 表头的一行 */
export const HeaderRow = z.object({
  /** 这一行是什么：决定底色，也决定面板怎么用它（字段名行当列标题、类型行决定参数类型……） */
  kind: z.enum(SHEET_ROLES),
  /** 这一行叫什么（「导出标记」「默认值」……）；不写就用 kind 的名字 */
  label: z.string().trim().max(20).optional(),
  /** 这一行能填什么：通用枚举名，或 TYPE_NAMES（基础类型 + 通用枚举名）；不写就不限 */
  values: z.string().max(200).optional(),
})
export type HeaderRow = z.infer<typeof HeaderRow>

/** 一份表头：从第 start 行（从 0 数）开始，rows 有几项就是几行；rows 为空表示没有表头，整张表都是数据 */
export const HeaderRule = z.object({
  start: z.number().int().min(0).max(1000).default(0),
  rows: z.array(HeaderRow).max(HEADER_MAX_ROWS).default([]),
})
export type HeaderRule = z.infer<typeof HeaderRule>

/**
 * 按文件指定的表头：内容和项目表头不一样的表按通配指定（AI 分析也会写到这里）。
 * 写了 sheet 就只管这个工作表（表格页「调整表头」单独改一张表时就是这样一条）；glob 为空的条目不生效，
 * 留着等用户填（旧配置里多出来的几套表头转过来时就是这样）
 */
export const HeaderException = z.object({
  glob: z.string().max(300),
  sheet: z.string().max(200).optional(),
  header: HeaderRule,
})
export type HeaderException = z.infer<typeof HeaderException>

export const emptyRule = (): HeaderRule => ({ start: 0, rows: [] })

/** 表格页用的表头：面板组件认的 SheetHeader，再带上每行能填什么 */
export interface TableHeader extends SheetHeader {
  values: (string | undefined)[]
}

export function toSheetHeader(rule: HeaderRule): TableHeader {
  const labels = rule.rows.map((r) => r.label ?? '')
  return {
    start: rule.start,
    roles: rule.rows.map((r) => r.kind),
    ...(labels.some(Boolean) ? { labels } : {}),
    values: rule.rows.map((r) => r.values),
  }
}

/**
 * SheetHeader 换回配置：同一位置、同一种行原来设过「能填什么」的照留（面板自带的表头编辑器不管这一项）
 */
export function fromSheetHeader(h: SheetHeader, prev?: HeaderRule): HeaderRule {
  return {
    start: h.start,
    rows: h.roles.map((kind, i) => {
      const old = prev?.rows[i]
      const label = h.labels?.[i]?.trim()
      return {
        kind,
        ...(label ? { label } : {}),
        ...(old?.kind === kind && old.values ? { values: old.values } : {}),
      }
    }),
  }
}

/** 两份表头是不是一样（比较保存前后、判断这张表是不是单独设过） */
export const sameRule = (a: HeaderRule, b: HeaderRule) => JSON.stringify(a) === JSON.stringify(b)

/** 表头里当列标题的那一行在第几项（字段名行；没有就是注释行），没有返回 -1 */
export function titleIndex(rule: HeaderRule) {
  const i = rule.rows.findIndex((r) => r.kind === 'name')
  return i >= 0 ? i : rule.rows.findIndex((r) => r.kind === 'comment')
}

/** 表头里第一行这种 kind 的位置 */
export const kindIndex = (rule: HeaderRule, kind: SheetRole) => rule.rows.findIndex((r) => r.kind === kind)

/** 按顺序列出每行是什么，拼一份表头（测试、新建表格的起点用） */
export const ruleOf = (kinds: SheetRole[], start = 0): HeaderRule => ({ start, rows: kinds.map((kind) => ({ kind })) })
