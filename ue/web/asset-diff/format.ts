import { t } from '../host.ts'

/** 差异表格里一个值怎么写：标量原样，布尔写 true / false，结构体和数组写成一行 JSON（太长截断，悬停看全） */
export function fmtValue(v: unknown, max = 160): string {
  if (v === undefined) return ''
  if (v === null) return t('无')
  if (typeof v === 'string') return v === '' ? '""' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** 完整的值（悬停提示） */
export const fullValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
