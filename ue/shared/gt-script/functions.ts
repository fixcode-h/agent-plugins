/**
 * 表达式内置函数（协议第 3 节）：名字、参数写法、参数个数。全部只读。
 * 表达式框的补全和离线校验按它查「是不是内置函数、参数个数对不对」；说明文字在 web 的 gt-cond/expr-docs.ts（要翻译）。
 * GameTest 加了新函数就在这里加一行（和 C++ 的 FGameTestExprRegistry 对上）
 */
export interface ExprFunction {
  name: string
  /** 参数写法，补全时显示：sel 选择器、x 值、n 小数位 */
  sig: string
  min: number
  /** -1 = 不限 */
  max: number
  group: 'widget' | 'convert' | 'math' | 'text' | 'vector' | 'time'
}

const f = (name: string, sig: string, min: number, max: number, group: ExprFunction['group']): ExprFunction => ({
  name,
  sig,
  min,
  max,
  group,
})

export const EXPR_FUNCTIONS: ExprFunction[] = [
  ...['text', 'number', 'visible', 'enabled', 'exists', 'onScreen', 'checked', 'count'].map((n) =>
    f(n, 'sel', 1, 1, 'widget'),
  ),
  ...['len', 'str', 'num', 'int', 'bool'].map((n) => f(n, 'x', 1, 1, 'convert')),
  f('round', 'x, n?', 1, 2, 'math'),
  f('floor', 'x', 1, 1, 'math'),
  f('ceil', 'x', 1, 1, 'math'),
  f('abs', 'x', 1, 1, 'math'),
  f('min', 'a, b, …', 1, -1, 'math'),
  f('max', 'a, b, …', 1, -1, 'math'),
  f('clamp', 'x, a, b', 3, 3, 'math'),
  f('contains', 'a, b', 2, 2, 'text'),
  f('startsWith', 'a, b', 2, 2, 'text'),
  f('endsWith', 'a, b', 2, 2, 'text'),
  f('lower', 's', 1, 1, 'text'),
  f('upper', 's', 1, 1, 'text'),
  f('trim', 's', 1, 1, 'text'),
  f('replace', 's, a, b', 3, 3, 'text'),
  f('split', 's, sep', 2, 2, 'text'),
  f('join', 'arr, sep', 2, 2, 'text'),
  f('format', 'fmt, …', 1, -1, 'text'),
  f('vec', 'x, y, z', 3, 3, 'vector'),
  f('dist', 'a, b', 2, 2, 'vector'),
  f('now', '', 0, 0, 'time'),
]

const byName = new Map(EXPR_FUNCTIONS.map((x) => [x.name, x]))

export const exprFunction = (name: string) => byName.get(name)

/** 取值来源（协议 4.3）：@ 后面能写的名字。sub、actor、obj、luaMod、luaG、cvar 后面要接名字或方括号 */
export const VALUE_SOURCES = [
  'gi',
  'gs',
  'gm',
  'ps',
  'pc',
  'pawn',
  'hud',
  'sub',
  'actor',
  'obj',
  'luaMod',
  'luaG',
  'cvar',
] as const
/** 控件 / 条目上的字段（条件 field 用）：@self 反射、@lua 绑的 Lua 实例、@item 条目数据对象、@itemLua */
export const FIELD_SOURCES = ['self', 'lua', 'item', 'itemLua'] as const
