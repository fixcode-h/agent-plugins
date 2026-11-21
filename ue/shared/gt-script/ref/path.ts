/**
 * 属性路径 v5（UEKit docs/game-test-ref.md 3.1）：从 `@`（对象自己）或 `@item`（列表条目的数据对象）出发，每段一个符号。
 * `/名字` 子控件或组件，`.名字` 反射属性，`.名字()` / `.名字(1, "a")` 取值函数（2.1.6 起可带常量参数），`#名字` Lua 字段，`:名字` 运行状态（只在最后），`[i]` / `["键"]` 下标。
 * 进了 Lua 之后（`#a.b`）只有 Lua 表：`.b` 是表字段（解析成 lua 段），不能再接 `.f()`、`:状态`、`#`（和 C++ 一致，报 path_syntax）。
 * 底层存盘和匹配用它；界面上只显示成小块（web/path-chips），不出现这些符号。
 */
export type GtPathSegKind = 'child' | 'prop' | 'fn' | 'lua' | 'state' | 'index'

export interface GtPathSeg {
  kind: GtPathSegKind
  name: string
  /** fn 段括号里的原文（GameTest 2.1.6）：逗号分开的常量，没写参数时不给 */
  args?: string
}

/** 从 `(` 起找配对的 `)`，引号里的不算；找不到返回 -1（和 C++ FindArgsClose 一致） */
function argsClose(s: string, open: number): number {
  let quote = ''
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === ')') return i
  }
  return -1
}

/**
 * 函数参数的原文 → 值（GameTest 2.1.6）：只认常量（数字、"文字" / '文字'、true / false / null），逗号分开。
 * 写法不对返回 `{ error }`（和 C++ FGameTestPropPath::ParseArgs 一致）
 */
export function parseFnArgs(text: string): unknown[] | { error: string } {
  const t = text.trim()
  if (!t) return []
  const parts: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quote) {
      cur += c
      if (c === '\\' && i + 1 < t.length) cur += t[++i]
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      cur += c
    } else if (c === ',') {
      parts.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (quote) return { error: '函数参数的引号不配对' }
  parts.push(cur.trim())
  const out: unknown[] = []
  for (const [i, p] of parts.entries()) {
    const q = p[0]
    if (p.length >= 2 && (q === '"' || q === "'") && p.endsWith(q))
      out.push(p.slice(1, -1).replace(/\\(["'\\])/g, '$1'))
    else if (p === 'true' || p === 'false') out.push(p === 'true')
    else if (p === 'null') out.push(null)
    else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(p)) out.push(Number(p))
    else
      return { error: `第 ${i + 1} 个参数「${p.slice(0, 40)}」不认识：函数参数只能写数字、"文字"、true / false / null` }
  }
  return out
}

/** 值 → 参数原文（parseFnArgs 的反操作，字符串用双引号） */
export const formatFnArgs = (values: unknown[]) =>
  values
    .map((v) => (typeof v === 'string' ? JSON.stringify(v) : v === null || v === undefined ? 'null' : String(v)))
    .join(', ')

export interface GtPathParsed {
  /** self = `@`，item = `@item` */
  root: 'self' | 'item'
  segs: GtPathSeg[]
}

// 名字里可以嵌 $变量（按文字替换，`Claim_$what`，和部件写法一致）
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** 拆开；写法不对返回 `{ error, at }`（at 是第几个字符，从 0 起） */
export function parsePropPath(text: string): GtPathParsed | { error: string; at: number } {
  const s = text.trim()
  if (!s.startsWith('@')) return { error: '属性路径以 @ 开头', at: 0 }
  let i = 1
  let root: GtPathParsed['root'] = 'self'
  if (s.startsWith('@item') && !IDENT.test(s.slice(5, 6) || '#')) {
    root = 'item'
    i = 5
  }
  const segs: GtPathSeg[] = []
  while (i < s.length) {
    const c = s[i]
    if (c === '[') {
      const close = s.indexOf(']', i)
      if (close < 0) return { error: '方括号不配对', at: i }
      if (!segs.length || segs[segs.length - 1].kind === 'child') return { error: '下标要跟在属性后面', at: i }
      const key = s
        .slice(i + 1, close)
        .trim()
        .replace(/^["'](.*)["']$/, '$1')
      if (!key) return { error: '方括号里是空的', at: i }
      segs.push({ kind: 'index', name: key })
      i = close + 1
      continue
    }
    if (!'/.#:'.includes(c)) return { error: `「${c}」不认识：每段以 / . # : 开头`, at: i }
    let j = i + 1
    // 函数段的括号（2.1.6 起可以带参数）：括号里的 . / : 、引号里的字符不算分段
    let open = -1
    let close = -1
    while (j < s.length && !'/.#:['.includes(s[j])) {
      if (s[j] === '(') {
        open = j
        close = argsClose(s, j)
        if (close < 0) return { error: '函数的括号不配对', at: j }
        j = close + 1
        break
      }
      j++
    }
    let name = s.slice(i + 1, open >= 0 ? open : j)
    let kind: GtPathSegKind = c === '/' ? 'child' : c === '#' ? 'lua' : c === ':' ? 'state' : 'prop'
    if (segs.some((x) => x.kind === 'lua')) {
      // Lua 表里没有反射函数和算出状态；表字段用 . 接
      if (c === ':') return { error: 'Lua 字段后面不能接运行状态', at: i }
      if (c === '#') return { error: 'Lua 字段后面的表字段用 . 接', at: i }
      if (open >= 0) return { error: 'Lua 字段后面不能调函数', at: i + 1 }
      if (kind === 'prop') kind = 'lua'
    }
    let args: string | undefined
    if (open >= 0) {
      if (kind !== 'prop') return { error: '只有 .函数() 能写括号', at: open }
      kind = 'fn'
      args = s.slice(open + 1, close).trim()
      const parsed = parseFnArgs(args)
      if ('error' in parsed) return { error: parsed.error, at: open + 1 }
    }
    if (!IDENT.test(name)) return { error: `「${name}」不是合法的名字`, at: i + 1 }
    if (kind === 'child' && segs.some((x) => x.kind !== 'child')) return { error: '子控件要写在属性前面', at: i }
    if (segs.length && segs[segs.length - 1].kind === 'state') return { error: '运行状态只能在最后', at: i }
    segs.push(args ? { kind, name, args } : { kind, name })
    i = j
  }
  return { root, segs }
}

/** 拼回文字（parsePropPath 的反操作） */
export function formatPropPath(p: GtPathParsed): string {
  let out = p.root === 'item' ? '@item' : '@'
  let lua = false
  for (const s of p.segs) {
    // 第一个 Lua 段写 #，之后的表字段写 .
    if (s.kind === 'lua') {
      out += `${lua ? '.' : '#'}${s.name}`
      lua = true
    } else if (s.kind === 'index') out += /^\d+$/.test(s.name) ? `[${s.name}]` : `["${s.name}"]`
    else if (s.kind === 'child') out += `/${s.name}`
    else if (s.kind === 'state') out += `:${s.name}`
    else if (s.kind === 'fn') out += `.${s.name}(${s.args ?? ''})`
    else out += `.${s.name}`
  }
  return out
}

/**
 * v4 的写法（`@self.X`、`@部件.X`、`@lua.X`、`@itemLua.X`、开头 `:状态`）：v5 不再认（不做迁移，用户 2026-11-21），
 * 校验报 path_old 并给出新写法。返回 undefined 表示不像旧写法（可能是新写法，也可能是别的错）
 */
export function oldPathHint(text: string): string | undefined {
  const s = text.trim()
  if (s.startsWith(':')) return `@${s}`
  const m = /^@([A-Za-z_一-鿿][\w一-鿿]*)(.*)$/.exec(s)
  if (!m) return undefined
  const [, head, rest] = m
  const low = head.toLowerCase()
  // `@item` 后面跟 . # : [ 或什么都没有是 v5 的条目数据对象
  if (low === 'item' && head === 'item') return undefined
  const tail = (r: string) => r.replace(/\.lua\./g, '#')
  if (low === 'self') return `@${tail(rest)}`
  if (low === 'lua') return `@#${rest.replace(/^\./, '')}`
  if (low === 'itemlua') return `@item#${rest.replace(/^\./, '')}`
  // `@部件.X` / `@Header.TxtTitle:text`：离线分不出哪几段是部件，按「最后一段之前都是部件」给个参考
  const body = `${head}${rest}`
  const state = body.indexOf(':')
  if (state >= 0) return `@/${body.slice(0, state).replace(/\./g, '/')}${body.slice(state)}`
  const lua = body.indexOf('.lua.')
  if (lua >= 0) return `@/${body.slice(0, lua).replace(/\./g, '/')}#${body.slice(lua + 5)}`
  const dot = body.lastIndexOf('.')
  return dot > 0 ? `@/${body.slice(0, dot).replace(/\./g, '/')}${body.slice(dot)}` : `@.${body}`
}

/** 部件写法（`Header.BtnClose` 或 `Header/BtnClose`）→ 子控件段 */
const partSegs = (part: string | undefined): GtPathSeg[] =>
  (part ?? '')
    .split(/[./]/)
    .filter(Boolean)
    .map((name) => ({ kind: 'child' as const, name }))

/** 路径里子控件 / 组件那几段（`@/Header/TxtTitle.Text` → `Header/TxtTitle`），没有返回空串 */
export function childOfPath(text: string): string {
  const p = parsePropPath(text)
  if ('error' in p) return ''
  return p.segs
    .filter((s) => s.kind === 'child')
    .map((s) => s.name)
    .join('/')
}

/**
 * 把一个从对象自己写的路径挪到部件上：`rebasePath('@.Text', 'Header.TxtTitle')` → `@/Header/TxtTitle.Text`，
 * `rebasePath('@:text', 'Btn')` → `@/Btn:text`。路径写法不对时原样返回（校验另外报）
 */
export function rebasePath(text: string, part: string | undefined): string {
  const s = text.trim()
  const p = parsePropPath(s)
  if ('error' in p) return text
  const extra = partSegs(part)
  if (!extra.length) return formatPropPath(p)
  const have = p.segs.filter((x) => x.kind === 'child')
  // 已经带着这个部件（UE 按部件读回来的项已经从外层对象写）就不再加
  const already = extra.every((x, i) => have[i]?.name === x.name)
  return formatPropPath(already ? p : { ...p, segs: [...extra, ...p.segs] })
}

/** 最后一段（判断它是状态、Lua 字段还是取值函数） */
export function lastSegOf(text: string): GtPathSeg | undefined {
  const p = parsePropPath(text)
  return 'error' in p ? undefined : p.segs.at(-1)
}
