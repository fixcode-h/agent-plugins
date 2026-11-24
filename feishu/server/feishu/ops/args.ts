import type { OpArgs } from './types.ts'

/**
 * 拼 lark-cli 参数的小工具。参数一律按数组交给进程（不过 shell），值里的空格、引号不用转义。
 *
 * 注意 lark-cli 的「输入类」参数（--content、--csv、--pattern 这些标了 File / Stdin 的）：值以 @ 开头会被当成
 * 本机文件路径读进去再发到飞书——Agent 给一个 `@~/.ssh/id_rsa` 就把本机文件写进了文档。这类参数一律经 stdin（`-`）给，
 * 一次调用只能有一个 stdin，第二个用 `@@` 转义（lark-cli 把 `@@` 开头还原成字面的 @）
 */

export const str = (a: OpArgs, k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
export const raw = (a: OpArgs, k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
export const num = (a: OpArgs, k: string) => {
  const v = typeof a[k] === 'number' ? a[k] : typeof a[k] === 'string' && a[k] !== '' ? Number(a[k]) : NaN
  return Number.isFinite(v) ? Math.trunc(v as number) : undefined
}
export const bool = (a: OpArgs, k: string) => a[k] === true || a[k] === 'true'
export const list = (a: OpArgs, k: string): string[] => {
  const v = a[k]
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string')
    return v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  return []
}

/** 有值才加：--flag value */
export function opt(out: string[], flag: string, v: string | number | undefined) {
  if (v === undefined || v === '') return
  out.push(`--${flag}`, String(v))
}

/** 输入类参数的第二个值：@ 开头转义成 @@，免得被当成本机文件 */
export const literal = (v: string) => (v.startsWith('@') ? `@${v}` : v)

/** 表格定位：sheet_id 和 sheet_name 二选一（都没给时由 lark-cli 报错说明） */
export function sheetRef(out: string[], a: OpArgs) {
  if (str(a, 'sheet_id')) opt(out, 'sheet-id', str(a, 'sheet_id'))
  else opt(out, 'sheet-name', str(a, 'sheet_name'))
}

/** 截一段给卡片看：太长的只看开头 */
export const brief = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…（共 ${s.length} 字）` : s)

/** 写入的差异：替换给出原文和新文，追加只有新文 */
export function diffOf(file: string, before: string, after: string) {
  const lines = (s: string) => (s ? s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [])
  const out = [`--- ${file}`, `+++ ${file}`, '@@']
  for (const l of lines(before)) out.push(`-${l}`)
  for (const l of lines(after)) out.push(`+${l}`)
  return out.slice(0, 200).join('\n')
}
