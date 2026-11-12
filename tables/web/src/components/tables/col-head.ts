import { useState } from 'react'
import { t } from '@shared/i18n'
import type { ColInfo, EnumOption } from '@shared/table-struct'
import type { SheetColHead, SheetColKind, SheetColTag, SheetTip } from '@/components/files/SheetTable'

/**
 * 表格页两行列头的内容：字段名 + 类型标签（类型、枚举、引用、数组、必填）。
 * 类型本身就是枚举名时只出一个枚举标签，不重复写两遍
 */
export function colHeadOf(info: ColInfo): SheetColHead | undefined {
  if (!info.field) return undefined
  const tags: SheetColTag[] = []
  if (info.enumName)
    tags.push({
      text: info.enumName,
      tone: 'enum',
      title: t('枚举 {e}', { e: info.enumName }),
    })
  if (info.type && info.type !== info.enumName && !(info.list && /\[\]$/.test(info.type) && info.enumName))
    tags.push({ text: info.type, tone: 'type' })
  if (info.ref) {
    const file = info.ref.split('#')[0] ?? ''
    tags.push({
      text: `→ ${file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')}`,
      tone: 'ref',
      title: t('引用 {ref}', { ref: info.ref }),
    })
  }
  if (info.list) tags.push({ text: '[ ]', tone: 'list', title: t('数组，分隔符 {sep}', { sep: info.sep }) })
  if (info.required) tags.push({ text: '*', tone: 'req', title: t('必填') })
  return { field: info.field, tags }
}

/**
 * 格子怎么显示：整数 / 浮点右对齐，布尔画小勾，枚举画胶囊（枚举数组每项一个）。
 * 备注列、引用列照原样；数字数组（「1;2;3」）不右对齐，读起来是一串文字
 */
export function colKindOf(info: ColInfo | undefined): SheetColKind | undefined {
  if (!info?.field || info.remark || info.ref) return undefined
  if (info.kind === 'enum' || info.enumName) return { kind: 'enum', sep: info.list ? info.sep : undefined }
  if (info.list) return undefined
  if (info.kind === 'int' || info.kind === 'uint' || info.kind === 'float') return { kind: 'num' }
  if (info.kind === 'bool') return { kind: 'bool' }
  return undefined
}

/** 「允许的值」最多列这么多个，再多写「等 N 个」 */
const ALLOW_SHOW = 12

/**
 * 不合规格子的悬停说明，分三行：原因（这一格错在哪）、规则（这一列的约束）、允许的值（枚举 / 引用的取值、额外允许的写法）。
 * 取值太多只列前面一些，提示框不至于铺满屏幕
 */
export function problemTip(msg: string, info: ColInfo | undefined, opts: EnumOption[] | undefined): SheetTip {
  const lines = [{ label: t('原因'), text: msg }]
  const rule = ruleText(info)
  if (rule) lines.push({ label: t('规则'), text: rule })
  const names = [...(opts ?? []).map((o) => o.name), ...(info?.allow ?? [])]
  if (names.length) {
    const head = names.slice(0, ALLOW_SHOW).join(' / ')
    lines.push({
      label: t('允许的值'),
      text: names.length > ALLOW_SHOW ? t('{list} 等 {n} 个', { list: head, n: names.length }) : head,
    })
  }
  return { title: info?.field ? t('{field} 不合规', { field: info.field }) : t('不合规'), tone: 'danger', lines }
}

/** 一列的规则写成一句（编辑栏右边显示）：「枚举 Size · 0~4 · 必填」 */
export function ruleText(info: ColInfo | undefined) {
  if (!info?.field) return ''
  const parts: string[] = []
  if (info.enumName) parts.push(t('枚举 {e}', { e: info.enumName }))
  else if (info.ref) parts.push(t('引用 {ref}', { ref: info.ref.replace(/^.*\//, '') }))
  else if (info.type) parts.push(info.type)
  if (info.list) parts.push(t('数组（{sep} 分隔）', { sep: info.sep }))
  if (info.min !== undefined || info.max !== undefined) parts.push(`${info.min ?? ''}~${info.max ?? ''}`)
  if (info.allow?.length) parts.push(t('也允许 {v}', { v: info.allow.join(' / ') }))
  if (info.pattern) parts.push(t('格式 {p}', { p: info.pattern }))
  if (info.required) parts.push(t('必填'))
  else if (info.requiredWhen)
    parts.push(t('{field} 是 {v} 时必填', { field: info.requiredWhen.field, v: info.requiredWhen.values.join(' / ') }))
  return parts.join(' · ')
}

/** 表格页的一个开关（表头折起、编辑栏、ID → 名称……）：整个表格页共用，记在本机 */
export function useLocalFlag(key: string, init = false) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key)
      return s === null ? init : s === '1'
    } catch {
      return init
    }
  })
  const set = (x: boolean) => {
    setV(x)
    try {
      localStorage.setItem(key, x ? '1' : '0')
    } catch {
      // 存不了就只在这次打开里有效
    }
  }
  return [v, set] as const
}

/** 表头行折没折起来 */
export const useHeadCollapsed = () => useLocalFlag('table-head-collapsed')

/** 表格页行高的三档：标准跟着设置 → 组件 → 数据表格的行高 */
export type Density = 'compact' | 'normal' | 'loose'
export const DENSITY_ROW_H: Record<Density, number | undefined> = { compact: 22, normal: undefined, loose: 32 }

/** 表格页的行高档：整个表格页一个，记在本机 */
export function useDensity() {
  const [v, setV] = useState<Density>(() => {
    try {
      const s = localStorage.getItem('table-density')
      return s === 'compact' || s === 'loose' ? s : 'normal'
    } catch {
      return 'normal'
    }
  })
  const set = (x: Density) => {
    setV(x)
    try {
      localStorage.setItem('table-density', x)
    } catch {
      // 存不了就只在这次打开里有效
    }
  }
  return [v, set] as const
}
