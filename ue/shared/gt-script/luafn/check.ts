import { LUA_PARAM, LUAFN_NAME, type LuaFn } from './schema.ts'

/**
 * 函数库和 Lua 代码节点的结构检查（用户 2026-11-28 定：函数库是一组普通函数，不许有类结构；测试 Lua 不落成文件）。
 * 只按文本认几种写法，不做语义分析：认错了宁可放过（写明原因让人看），不拦正常代码
 */

/** 类结构的写法：setmetatable / __index、class(…)、Class(…)、:new(、function A:b(、A.__index = A */
const CLASS_RULES: [RegExp, string][] = [
  [/\bsetmetatable\s*\(/, '用了 setmetatable（类结构）'],
  [/\b__index\b/, '用了 __index（类结构）'],
  [/\b[Cc]lass\s*\(/, '用了 class(…)（类结构）'],
  [/\bfunction\s+[\w.]+:\w+\s*\(/, '定义了 A:b 形式的方法（类结构）'],
]

/** 去掉注释和字符串里的内容，免得注释里写了 setmetatable 也被拦 */
export function stripLua(code: string): string {
  return code
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\[(=*)\[[\s\S]*?\]\1\]/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
}

export function classIssues(code: string): string[] {
  const s = stripLua(code)
  return CLASS_RULES.filter(([re]) => re.test(s)).map(([, why]) => why)
}

/** 写文件的调用：io.open(…, "w"/"a")、io.output、os.remove / os.rename（测试 Lua 不许往项目里写文件） */
export function fileWriteIssues(code: string): string[] {
  const out: string[] = []
  if (/\bio\.open\s*\([^)]*["'][wa]\+?b?["']/.test(code)) out.push('用 io.open 写文件')
  if (/\bio\.output\s*\(/.test(stripLua(code))) out.push('用 io.output 写文件')
  if (/\bos\.(remove|rename)\s*\(/.test(stripLua(code))) out.push('用 os.remove / os.rename 改文件')
  return out
}

/** 一个函数的问题（名字、参数、类结构、写文件），没有问题返回空数组 */
export function luaFnIssues(fn: LuaFn): string[] {
  const out: string[] = []
  if (!LUAFN_NAME.test(fn.name)) out.push(`函数名「${fn.name}」要写成「库.名字」`)
  for (const p of fn.params) if (!LUA_PARAM.test(p)) out.push(`参数名「${p}」只能是英文字母、数字、下划线`)
  if (new Set(fn.params).size !== fn.params.length) out.push('参数名重复')
  out.push(...classIssues(fn.body), ...fileWriteIssues(fn.body))
  return out
}

/** Lua 代码里调到的函数库函数：`fn["库.名字"]`、`fn['库.名字']` */
export function fnRefsIn(code: string): string[] {
  const out = new Set<string>()
  for (const m of code.matchAll(/\bfn\s*\[\s*(["'])([^"'\n]+)\1\s*\]/g)) out.add(m[2])
  return [...out]
}
