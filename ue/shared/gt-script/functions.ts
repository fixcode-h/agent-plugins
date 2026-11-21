/**
 * 表达式内置函数（协议第 3 节）：名字、参数写法、参数个数。全部只读。
 * 表达式框的补全和离线校验按它查「是不是内置函数、参数个数对不对」；说明文字在 web 的 gt-cond/expr-docs.ts（要翻译）。
 * GameTest 加了新函数就在这里加一行（和 C++ 的 FGameTestExprRegistry 对上）
 */
export interface ExprFunction {
  name: string
  /** 参数写法，补全时显示：ref 对象引用、path 属性路径、x 值、n 小数位 */
  sig: string
  min: number
  /** -1 = 不限 */
  max: number
  group: 'object' | 'convert' | 'math' | 'text' | 'vector' | 'time'
}

const f = (name: string, sig: string, min: number, max: number, group: ExprFunction['group']): ExprFunction => ({
  name,
  sig,
  min,
  max,
  group,
})

export const EXPR_FUNCTIONS: ExprFunction[] = [
  // v4（协议 game-test-ref 第 4 节）：对象上的属性和算出状态都用 prop 读，引用写命名引用、$var 或内联对象
  f('prop', 'ref, path', 2, 2, 'object'),
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

/**
 * v3 按选择器读控件的内置函数：v4 删掉了（校验报 expr_removed），改写成 prop(引用, "@:状态")。
 * 值是对应的属性路径（number 还要包一层 num，checked 要和 "Checked" 比）
 */
export const REMOVED_EXPR_FUNCTIONS: Record<string, string> = {
  text: '@:text',
  number: '@:text',
  visible: '@:shown',
  enabled: '@:enabled',
  exists: '@:exists',
  onScreen: '@:onScreen',
  checked: '@:checked',
  count: '@:count',
}

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
/** 对象上的属性路径 v5 的根（协议 3.1）：`@` 对象自己、`@item` 条目数据对象；后面每段一个符号（ref/path.ts） */
export const FIELD_SOURCES = ['', 'item'] as const
