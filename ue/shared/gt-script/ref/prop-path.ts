import { stateOf } from './states.ts'

/**
 * 属性路径（协议 3.1）：`@` 开头，`.` 是对象上存在的数据，`:` 是算出来的状态。
 * - `@self.X` 对象自己的反射属性；`@item.X` / `@itemLua.X` 条目的数据对象和它的 Lua 表；`@lua.X` 对象绑的 Lua 表
 * - `@部件.X`、`@Header.TxtTitle.Text`：第一段先按部件名找，找不到按 self 的属性名找——离线分不出来，记成 named，
 *   哪几段是部件要读类的 WidgetTree（gt.props / 校验在编辑器里做）
 * - `@部件.lua.X`：部件绑的 Lua 表；`@部件:状态`、`:状态`（= `@self:状态`）
 * 路径段大小写不敏感；下标 `[0]`、`["键"]` 原样留在段上。
 */
export type PropRoot = 'self' | 'item' | 'itemLua' | 'lua' | 'named'

export interface PropPath {
  root: PropRoot
  /** 根后面的段（root 是 named 时含第一段部件名 / 属性名） */
  segs: string[]
  /** `@部件.lua.X`：segs 里 lua 这一段的位置，前面是部件路径、后面是 Lua 字段 */
  luaAt?: number
  /** `:` 后面的状态名（注册表里的写法） */
  state?: string
}

export type PropPathError = 'empty' | 'no_at' | 'bad_seg' | 'unknown_state'

const ROOTS: Record<string, PropRoot> = { self: 'self', item: 'item', itemlua: 'itemLua', lua: 'lua' }
const NAME = /^[A-Za-z_一-鿿$][\w一-鿿$]*$/
const INDEX = /^(\[\s*(-?\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\])+$/

/** 按 `.` 切段，方括号和引号里的不切；遇到不在括号里的 `:` 停下，剩下的是状态 */
function split(body: string): { segs: string[]; state?: string } | undefined {
  const segs: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      cur += c
      if (c === '\\') cur += body[++i] ?? ''
      else if (c === quote) quote = ''
      continue
    }
    if (depth && (c === '"' || c === "'")) quote = c
    if (c === '[') depth++
    if (c === ']') depth--
    if (depth < 0) return undefined
    if (!depth && c === '.') {
      segs.push(cur)
      cur = ''
    } else if (!depth && c === ':') {
      segs.push(cur)
      return { segs, state: body.slice(i + 1) }
    } else cur += c
  }
  if (depth || quote) return undefined
  segs.push(cur)
  return { segs }
}

/** 一段：名字后面可以跟下标（`Items[0]`、`Map["k"]`），也可以只有下标（`[0]` 接在上一段后面时） */
const validSeg = (seg: string) => {
  const m = /^([^[]*)(.*)$/.exec(seg)!
  return (m[1] === '' ? m[2] !== '' : NAME.test(m[1])) && (m[2] === '' || INDEX.test(m[2]))
}

export function parsePropPath(raw: string): { path: PropPath } | { error: PropPathError } {
  const s = raw.trim()
  if (!s) return { error: 'empty' }
  if (s.startsWith(':')) {
    const st = stateOf(s.slice(1))
    return st ? { path: { root: 'self', segs: [], state: st.name } } : { error: 'unknown_state' }
  }
  if (!s.startsWith('@')) return { error: 'no_at' }
  const parts = split(s.slice(1))
  if (!parts) return { error: 'bad_seg' }
  let segs = parts.segs
  // `@self:状态`、`@Header:text`：状态前的段可以只有一段；`@:text` 不行
  if (segs.some((x) => !validSeg(x))) return { error: 'bad_seg' }
  let state: string | undefined
  if (parts.state !== undefined) {
    const st = stateOf(parts.state)
    if (!st) return { error: 'unknown_state' }
    state = st.name
  }
  const root = ROOTS[segs[0].toLowerCase()] ?? 'named'
  if (root !== 'named') segs = segs.slice(1)
  // @self / @item 后面什么都没有、又不是状态：读的是对象本身，不是属性
  if (root !== 'named' && !segs.length && !state) return { error: 'bad_seg' }
  const luaAt = root === 'named' ? segs.findIndex((x, i) => i > 0 && x.toLowerCase() === 'lua') : -1
  return { path: { root, segs, ...(luaAt > 0 ? { luaAt } : {}), ...(state ? { state } : {}) } }
}

/** 拼回去（规范写法：根关键字小写、状态名用注册表里的写法） */
export function formatPropPath(p: PropPath): string {
  const head = p.root === 'named' ? '' : p.root
  const body = [head, ...p.segs].filter((x) => x !== '').join('.')
  if (p.root === 'self' && !p.segs.length && p.state) return `:${p.state}`
  return `@${body}${p.state ? `:${p.state}` : ''}`
}

/** 部件上的状态 / 字段：`@Part:text` 的 Part（named 根的第一段起、到 lua 或末尾），只在有状态时才能确定是部件 */
export function partOfProp(p: PropPath): string | undefined {
  if (p.root !== 'named') return undefined
  if (p.state) return p.segs.join('.')
  if (p.luaAt !== undefined) return p.segs.slice(0, p.luaAt).join('.')
  return undefined
}

/** 在一个属性路径前加上部件（迁移时 target 的部件 + 状态 → `@部件:状态`） */
export const propOnPart = (part: string | undefined, rest: string) =>
  part ? `@${part}${rest.startsWith(':') ? rest : `.${rest.replace(/^@/, '')}`}` : rest
