/**
 * 属性路径 v5（UEKit docs/game-test-ref.md 3.1）：从 `@`（对象自己）或 `@item`（列表条目的数据对象）出发，每段一个符号。
 * `/名字` 子控件或组件，`.名字` 反射属性，`.名字()` 无参取值函数，`#名字` Lua 字段，`:名字` 运行状态（只在最后），`[i]` / `["键"]` 下标。
 * 底层存盘和匹配用它；界面上只显示成小块（web/path-chips），不出现这些符号。
 */
export type GtPathSegKind = 'child' | 'prop' | 'fn' | 'lua' | 'state' | 'index'

export interface GtPathSeg {
  kind: GtPathSegKind
  name: string
}

export interface GtPathParsed {
  /** self = `@`，item = `@item` */
  root: 'self' | 'item'
  segs: GtPathSeg[]
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

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
    while (j < s.length && !'/.#:['.includes(s[j])) j++
    let name = s.slice(i + 1, j)
    let kind: GtPathSegKind = c === '/' ? 'child' : c === '#' ? 'lua' : c === ':' ? 'state' : 'prop'
    if (kind === 'prop' && name.endsWith('()')) {
      kind = 'fn'
      name = name.slice(0, -2)
    }
    if (!IDENT.test(name)) return { error: `「${name}」不是合法的名字`, at: i + 1 }
    if (kind === 'child' && segs.some((x) => x.kind !== 'child')) return { error: '子控件要写在属性前面', at: i }
    if (segs.length && segs[segs.length - 1].kind === 'state') return { error: '运行状态只能在最后', at: i }
    segs.push({ kind, name })
    i = j
  }
  return { root, segs }
}

/** 拼回文字（parsePropPath 的反操作） */
export function formatPropPath(p: GtPathParsed): string {
  let out = p.root === 'item' ? '@item' : '@'
  for (const s of p.segs) {
    if (s.kind === 'index') out += /^\d+$/.test(s.name) ? `[${s.name}]` : `["${s.name}"]`
    else if (s.kind === 'child') out += `/${s.name}`
    else if (s.kind === 'lua') out += `#${s.name}`
    else if (s.kind === 'state') out += `:${s.name}`
    else if (s.kind === 'fn') out += `.${s.name}()`
    else out += `.${s.name}`
  }
  return out
}
