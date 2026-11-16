import type { LuaGmItem, LuaGmParam } from './types.ts'

/**
 * Lua GM 的调用代码怎么拼（纯函数）：服务端执行时用，网页的「会执行」预览也直接用这一份，两边拼出来的一样。
 * 出错信息是中文原文，服务端和网页各自显示
 */
const NUM = /^(int|integer|number|float|double|int32|int64|uint\d*)$/i
const BOOL = /^(bool|boolean)$/i
const STR = /^(string|str|fstring|name|text)$/i

/** Lua 字符串字面量：双引号，转义反斜杠、引号和换行 */
export const luaString = (v: string) =>
  `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`

/** 一个参数的值写成 Lua 代码：数字、布尔查格式，字符串加引号，其它类型（table、any）按 Lua 表达式原样用 */
export function luaValue(p: LuaGmParam, raw: unknown): string {
  const v = raw === undefined || raw === null ? '' : String(raw).trim()
  if (!v) return p.default !== undefined ? p.default : 'nil'
  if (NUM.test(p.type)) {
    if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$|^-?0x[0-9a-f]+$/i.test(v))
      throw new Error(`参数 ${p.name} 要填数字，现在是「${v}」`)
    return v
  }
  if (BOOL.test(p.type)) {
    if (!/^(true|false)$/i.test(v)) throw new Error(`参数 ${p.name} 要填 true 或 false`)
    return v.toLowerCase()
  }
  if (STR.test(p.type)) return luaString(String(raw))
  return v
}

/**
 * 生成调用代码：call 里 {参数名} 换成参数值、{args} 换成全部参数；没有 call 时是 名字(参数, …)。
 * 末尾留空的可选参数（nil）去掉，免得 GM 里按参数个数判断的写法收到多余的 nil
 */
export function luaCall(it: LuaGmItem, args: unknown[]): string {
  const vals = it.params.map((p, i) => luaValue(p, args[i]))
  while (vals.length && vals.at(-1) === 'nil' && it.params[vals.length - 1].default === undefined) vals.pop()
  const all = vals.join(', ')
  if (!it.call) return `${it.name}(${all})`
  return it.call.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (k === 'args') return all
    const i = it.params.findIndex((p) => p.name === k)
    return i < 0 ? m : (vals[i] ?? 'nil')
  })
}
