import { REMOVED_EXPR_FUNCTIONS } from '../../functions.ts'
import type { GtRefLike } from '../types.ts'
import { todo, type MigrateCtx } from './context.ts'
import { selectorToTarget } from './selector.ts'

/**
 * 表达式里 v3 按选择器读控件的函数（`text("WBP_X:Root/Txt")` 等）→ `prop(引用, "@部件:状态")`（协议第 9 节最后一行）。
 * 参数不是字符串字面量（变量、拼出来的）时改不了，留原样写 todo，校验报 expr_removed。
 * 不解析整棵语法树：按字符扫，跳过字符串，只认「函数名(字面量)」这一种写法，别的原样不动
 */
const NAME = /[A-Za-z_]/
const WORD = /[\w$@.]/

/** 引用写进表达式：命名引用和 $var 原样（名字加引号），内联写成对象字面量 */
export const refInExpr = (ref: GtRefLike) =>
  typeof ref === 'string' && ref.startsWith('$') ? ref : JSON.stringify(ref)

/** prop(引用, "路径") 的表达式文字 */
export function propCall(ref: GtRefLike, part: string | undefined, state: string) {
  return `prop(${refInExpr(ref)}, ${JSON.stringify(part ? `@${part}${state}` : state)})`
}

/** 读一个字符串字面量：返回值和结束位置（不含右引号后的） */
function readString(src: string, i: number): { value: string; end: number } | undefined {
  const q = src[i]
  if (q !== '"' && q !== "'") return undefined
  let v = ''
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') {
      v += src[j + 1] ?? ''
      j++
    } else if (c === q) return { value: v, end: j + 1 }
    else v += c
  }
  return undefined
}

const skipSpace = (src: string, i: number) => {
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

export function migrateExpr(src: string, ctx: MigrateCtx): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'") {
      const s = readString(src, i)
      const end = s ? s.end : src.length
      out += src.slice(i, end)
      i = end
      continue
    }
    if (NAME.test(c) && (i === 0 || !WORD.test(src[i - 1]))) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!
      const name = m[0]
      const open = skipSpace(src, i + name.length)
      if (name in REMOVED_EXPR_FUNCTIONS && src[open] === '(') {
        const at = skipSpace(src, open + 1)
        const v = /^\$([A-Za-z_]\w*)/.exec(src.slice(at))
        // 参数是存着选择器的变量（vars 里的初值）：按它的值迁
        const arg =
          readString(src, at) ?? (v && ctx.selVars.has(v[1]) ? { value: v[0], end: at + v[0].length } : undefined)
        const close = arg ? skipSpace(src, arg.end) : -1
        const t = arg && src[close] === ')' ? selectorToTarget(arg.value, ctx) : undefined
        if (t) {
          const read = propCall(t.obj, t.part, REMOVED_EXPR_FUNCTIONS[name])
          out += name === 'number' ? `num(${read})` : name === 'checked' ? `(${read} == "Checked")` : read
          i = close + 1
          continue
        }
        todo(
          ctx,
          `表达式里的 ${name}(…) 参数不是写死的选择器，改不了：改成 prop(引用, "${REMOVED_EXPR_FUNCTIONS[name]}")`,
        )
      }
      out += name
      i += name.length
      continue
    }
    out += c
    i++
  }
  return out
}

/** 一个值里所有的表达式（`"=…"` 和 expr 字段）都改写；返回新值（不改传入的） */
export function migrateExprsIn(v: unknown, ctx: MigrateCtx, key?: string): unknown {
  if (typeof v === 'string') {
    if (key === 'expr') return migrateExpr(v, ctx)
    return v.startsWith('=') ? `=${migrateExpr(v.slice(1), ctx)}` : v
  }
  if (Array.isArray(v)) return v.map((x) => migrateExprsIn(x, ctx))
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, migrateExprsIn(x, ctx, k)]))
  return v
}
