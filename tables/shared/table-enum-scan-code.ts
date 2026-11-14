/**
 * 枚举扫描的代码类写法：从 C++ / Lua 源码或按两个正则扫出枚举（规则格式在 table-enum-scan.ts）。
 * 都是轻量的词法扫描（去注释、配括号），不是完整的语法分析：宏展开出来的、条件编译里的成员不保证，
 * 碰到这类拿不准的地方记成提醒（带文件和行号），让用户决定要不要改规则。一个文件一次，结果由调用方合并。
 */
import { t } from './i18n.ts'
import type { CodeFrom } from './table-enum-scan.ts'

interface Member {
  name: string
  value?: string
  desc?: string
}
export interface CodeScan {
  enums: Record<string, Member[]>
  warnings: string[]
}

/** 写坏了的正则返回 null（调用方报错）；空的返回 undefined（不用） */
export function compileRe(src: string, flags = '') {
  if (!src.trim()) return undefined
  try {
    return new RegExp(src, flags)
  } catch {
    return null
  }
}

const lineOf = (text: string, at: number) => {
  let n = 1
  for (let i = 0; i < at && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/**
 * 把注释换成空格（换行留着，位置和原文一一对应），字符串原样留着。
 * lua 时注释是 -- 和 --[[ ]]，字符串还有 [[ ]]；cpp 时是 // 和 /* *\/
 */
export function maskComments(text: string, lang: 'cpp' | 'lua') {
  const out = text.split('')
  const blank = (a: number, b: number) => {
    for (let i = a; i < b && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      i = j + 1
      continue
    }
    if (lang === 'cpp') {
      if (c === '/' && text[i + 1] === '/') {
        const e = text.indexOf('\n', i)
        const end = e < 0 ? text.length : e
        blank(i, end)
        i = end
        continue
      }
      if (c === '/' && text[i + 1] === '*') {
        const e = text.indexOf('*/', i + 2)
        const end = e < 0 ? text.length : e + 2
        blank(i, end)
        i = end
        continue
      }
    } else {
      const long = /^\[(=*)\[/.exec(text.slice(i, i + 20))
      if (long) {
        const close = `]${long[1]}]`
        const e = text.indexOf(close, i)
        i = e < 0 ? text.length : e + close.length
        continue
      }
      if (c === '-' && text[i + 1] === '-') {
        const lc = /^--\[(=*)\[/.exec(text.slice(i, i + 20))
        let end: number
        if (lc) {
          const close = `]${lc[1]}]`
          const e = text.indexOf(close, i)
          end = e < 0 ? text.length : e + close.length
        } else {
          const e = text.indexOf('\n', i)
          end = e < 0 ? text.length : e
        }
        blank(i, end)
        i = end
        continue
      }
    }
    i++
  }
  return out.join('')
}

/** 从 at（指向开括号）找配对的闭括号；masked 里注释已经去掉，字符串里的括号跳过 */
export function matchClose(masked: string, at: number, open = '{', close = '}') {
  let depth = 0
  for (let i = at; i < masked.length; i++) {
    const c = masked[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < masked.length && masked[j] !== c && masked[j] !== '\n') j += masked[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

/** 按顶层的分隔符切开（括号、花括号、字符串里的不算），返回每段的起止位置 */
function splitTop(masked: string, from: number, to: number, seps: string) {
  const parts: [number, number][] = []
  let depth = 0
  let start = from
  for (let i = from; i < to; i++) {
    const c = masked[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < to && masked[j] !== c && masked[j] !== '\n') j += masked[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (depth === 0 && seps.includes(c)) {
      parts.push([start, i])
      start = i + 1
    }
  }
  parts.push([start, to])
  return parts
}

/** 原文里一段之后、同一行的注释（成员行尾的说明） */
function trailingComment(text: string, masked: string, from: number, lang: 'cpp' | 'lua') {
  const e = text.indexOf('\n', from)
  const line = text.slice(from, e < 0 ? text.length : e)
  const m = (lang === 'cpp' ? /\/\/+\s*<?\s*(.*)$|\/\*+\s*<?\s*(.*?)\s*\*\// : /--+\s*(.*)$/).exec(line)
  // 注释在 masked 里是空白：行尾那段不是空白就说明碰到的是代码，不算
  if (!m) return undefined
  const at = from + (m.index ?? 0)
  if (masked.slice(from, at).trim().replace(/^[,;]/, '').trim()) return undefined
  return (m[1] ?? m[2] ?? '').trim() || undefined
}

/** 原文里一段之前的注释（成员上一行的 /// 说明） */
function leadingComment(text: string, from: number, to: number, lang: 'cpp' | 'lua') {
  const seg = text.slice(from, to)
  const re = lang === 'cpp' ? /\/\/+\s*(.*)|\/\*+\s*([\s\S]*?)\s*\*\//g : /--+\s*(.*)/g
  let last: string | undefined
  for (const m of seg.matchAll(re)) last = (m[1] ?? m[2] ?? '').trim() || last
  return last
}

// ---------- 整数表达式（C++ 枚举的值：1 << 3、A | B、0x10……） ----------

export function evalInt(raw: string, known: Map<string, number>): number | undefined {
  // 整数后缀（1u、2ull）去掉；static_cast 之类剩下认不得的字，整个算不出
  const expr = raw.replace(/(\d)[uUlL]+\b/g, '$1')
  const toks = expr.match(
    /0[xX][0-9a-fA-F]+|0[bB][01]+|\d+|'(?:\\.|[^'])'|[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*|<<|>>|[-+*/%&|^~()]/g,
  )
  if (!toks || toks.join('') !== expr.replace(/\s+/g, '')) return undefined
  let i = 0
  const peek = () => toks[i]
  const num = (s: string): number | undefined => {
    if (/^0[xX]/.test(s)) return Number.parseInt(s.slice(2), 16)
    if (/^0[bB]/.test(s)) return Number.parseInt(s.slice(2), 2)
    if (/^\d+$/.test(s)) return /^0\d/.test(s) ? Number.parseInt(s, 8) : Number(s)
    if (s.startsWith("'")) {
      const body = s.slice(1, -1)
      return body.startsWith('\\')
        ? ({ n: 10, t: 9, r: 13, '0': 0 } as Record<string, number>)[body[1]]
        : body.charCodeAt(0)
    }
    const k = known.get(s) ?? known.get(s.replace(/.*::/, ''))
    return k
  }
  const prim = (): number | undefined => {
    const tk = toks[i++]
    if (tk === undefined) return undefined
    if (tk === '(') {
      const v = bin(0)
      if (toks[i++] !== ')') return undefined
      return v
    }
    if (tk === '-') {
      const v = prim()
      return v === undefined ? undefined : -v
    }
    if (tk === '+') return prim()
    if (tk === '~') {
      const v = prim()
      return v === undefined ? undefined : ~v
    }
    return num(tk)
  }
  const PREC: Record<string, number> = {
    '|': 1,
    '^': 2,
    '&': 3,
    '<<': 4,
    '>>': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
  }
  const bin = (min: number): number | undefined => {
    let l = prim()
    while (l !== undefined && peek() !== undefined && PREC[peek()] !== undefined && PREC[peek()] > min) {
      const op = toks[i++]
      const r = bin(PREC[op])
      if (r === undefined) return undefined
      l =
        op === '|'
          ? l | r
          : op === '^'
            ? l ^ r
            : op === '&'
              ? l & r
              : op === '<<'
                ? l << r
                : op === '>>'
                  ? l >> r
                  : op === '+'
                    ? l + r
                    : op === '-'
                      ? l - r
                      : op === '*'
                        ? l * r
                        : op === '/'
                          ? r
                            ? Math.trunc(l / r)
                            : NaN
                          : r
                            ? l % r
                            : NaN
    }
    return l
  }
  const v = bin(0)
  return i === toks.length && v !== undefined && Number.isFinite(v) ? v : undefined
}

// ---------- C++ ----------

const ENUM_RE =
  /\b(UENUM\s*\((?:[^()]|\([^()]*\))*\)\s*)?enum\s+(?:class\s+|struct\s+)?(?:[A-Z_]+_API\s+)?([A-Za-z_]\w*)?\s*(?::\s*[\w:\s]+?)?\s*\{/g

function umeta(seg: string) {
  const m = /\bUMETA\s*\(/.exec(seg)
  if (!m) return { rest: seg, meta: '' }
  const open = m.index + m[0].length - 1
  const close = matchClose(seg, open, '(', ')')
  const end = close < 0 ? seg.length : close + 1
  return { rest: seg.slice(0, m.index) + seg.slice(end), meta: seg.slice(open + 1, end - 1) }
}
const metaStr = (meta: string, key: string) => new RegExp(`\\b${key}\\s*=\\s*"((?:\\\\.|[^"])*)"`).exec(meta)?.[1]

export function scanCpp(text: string, from: Extract<CodeFrom, { kind: 'cpp' }>, file: string): CodeScan {
  const enums: CodeScan['enums'] = {}
  const warnings: string[] = []
  const masked = maskComments(text, 'cpp')
  const skip = compileRe(from.skip)
  for (const m of masked.matchAll(ENUM_RE)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const before = masked.slice(Math.max(0, (m.index ?? 0) - 400), m.index)
    const ns = /(UENUM\s*\((?:[^()]|\([^()]*\))*\)\s*)?namespace\s+([A-Za-z_]\w*)\s*\{\s*$/.exec(before)
    let name = m[2]
    // UE 老写法：namespace EFoo { enum Type { ... } }，枚举名用 namespace 的
    if (ns && (!name || name === 'Type')) name = ns[2]
    if (!name) continue
    if (from.onlyUenum && !m[1] && !ns?.[1]) continue
    const close = matchClose(masked, open)
    if (close < 0) {
      warnings.push(t('{file}:{line} 的 {name} 找不到结尾的 }', { file, line: lineOf(text, open), name }))
      continue
    }
    const body = masked.slice(open + 1, close)
    if (/^\s*#\s*(if|ifdef|ifndef|else|elif)\b/m.test(body))
      warnings.push(
        t('{file}:{line} 的 {name} 里有 #if，条件编译里的成员都算上了，可能不全对', {
          file,
          line: lineOf(text, open),
          name,
        }),
      )
    const known = new Map<string, number>()
    const list: Member[] = []
    let next: number | undefined = 0
    let prevEnd = open + 1
    for (const [a, b] of splitTop(masked, open + 1, close, ',')) {
      // 预处理行（#if、#endif）不是成员
      const seg = masked.slice(a, b).replace(/^\s*#.*$/gm, '')
      const { rest, meta } = umeta(seg)
      const em = /^\s*([A-Za-z_]\w*)\s*(?:=\s*([\s\S]+?))?\s*$/.exec(rest)
      if (!em) {
        if (rest.trim())
          warnings.push(
            t('{file}:{line} 认不出这个成员：{text}', { file, line: lineOf(text, a), text: rest.trim().slice(0, 60) }),
          )
        prevEnd = b + 1
        continue
      }
      const mname = em[1]
      let value: string | undefined
      if (em[2] !== undefined) {
        const v = evalInt(em[2].trim(), known)
        if (v === undefined) {
          value = em[2].trim().slice(0, 60)
          next = undefined
          warnings.push(
            t('{file}:{line} 的 {name} 值算不出来，照原样记成「{expr}」', {
              file,
              line: lineOf(text, a),
              name: mname,
              expr: value,
            }),
          )
        } else {
          value = String(v)
          next = v + 1
        }
      } else if (next !== undefined) {
        value = String(next)
        next++
      }
      if (value !== undefined && /^-?\d+$/.test(value)) known.set(mname, Number(value))
      const hidden = /\bHidden\b/.test(meta)
      if ((from.skipHidden && hidden) || skip?.test(mname)) {
        prevEnd = b + 1
        continue
      }
      let desc: string | undefined
      if (from.desc === 'meta') desc = metaStr(meta, 'DisplayName') ?? metaStr(meta, 'ToolTip')
      if (from.desc !== 'none' && !desc)
        desc = trailingComment(text, masked, b, 'cpp') ?? leadingComment(text, prevEnd, a + seg.search(/\S|$/), 'cpp')
      list.push({
        name: mname,
        ...(value !== undefined ? { value } : {}),
        ...(desc ? { desc: desc.slice(0, 500) } : {}),
      })
      prevEnd = b + 1
    }
    if (enums[name]) warnings.push(t('{file} 里 {name} 定义了不止一次，只留第一个', { file, name }))
    else enums[name] = list
  }
  return { enums, warnings }
}

// ---------- Lua ----------

interface LuaEntry {
  key?: string
  /** 值：数字、字符串内容，或别的原文 */
  value: string
  kind: 'num' | 'str' | 'table' | 'other'
  /** 值是表时它在原文里的开括号位置 */
  at: number
  end: number
}

function luaString(s: string) {
  const m = /^(["'])((?:\\.|(?!\1).)*)\1$/s.exec(s) ?? /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(s)
  return m ? m[2] : undefined
}

function luaEntries(masked: string, open: number, close: number): LuaEntry[] {
  const out: LuaEntry[] = []
  for (const [a, b] of splitTop(masked, open + 1, close, ',;')) {
    const seg = masked.slice(a, b)
    if (!seg.trim()) continue
    const km = /^\s*(?:([A-Za-z_]\w*)|\[\s*(["'])(.*?)\2\s*\]|\[\s*(-?\d+)\s*\])\s*=(?!=)\s*/.exec(seg)
    const key = km ? (km[1] ?? km[3] ?? km[4]) : undefined
    const vs = a + (km ? km[0].length : seg.search(/\S/))
    const raw = masked.slice(vs, b).trim()
    const at = masked.indexOf(raw[0] ?? '', vs)
    let kind: LuaEntry['kind'] = 'other'
    let value = raw
    if (/^-?(0[xX][0-9a-fA-F]+|\d+(\.\d+)?([eE][-+]?\d+)?)$/.test(raw)) {
      kind = 'num'
      value = /^-?0[xX]/.test(raw) ? String(Number.parseInt(raw, 16)) : raw
    } else if (luaString(raw) !== undefined) {
      kind = 'str'
      value = luaString(raw)!
    } else if (raw.startsWith('{')) kind = 'table'
    out.push({ key, value, kind, at, end: b })
  }
  return out
}

export function scanLua(text: string, from: Extract<CodeFrom, { kind: 'lua' }>, file: string): CodeScan {
  const enums: CodeScan['enums'] = {}
  const warnings: string[] = []
  const masked = maskComments(text, 'lua')
  const nameRe = compileRe(from.names)
  const skip = compileRe(from.skip)
  const field = (e: LuaEntry, f: string) => {
    if (e.kind !== 'table' || !f) return undefined
    const c = matchClose(masked, e.at)
    const sub = c < 0 ? [] : luaEntries(masked, e.at, c)
    const hit = sub.find((x) => x.key === f && (x.kind === 'num' || x.kind === 'str'))
    return hit?.value
  }
  /** 一张表当一个枚举：成员是「名字 = 数字 / 字符串」，或值是表（按 valueField / descField 取），或一串字符串（值按位置 1、2、3） */
  const asEnum = (open: number, close: number, strict: boolean): Member[] | null => {
    const es = luaEntries(masked, open, close)
    if (!es.length) return null
    const keyed = es.every((e) => e.key !== undefined && !/^\d+$/.test(e.key))
    const strList = es.every((e) => e.key === undefined && e.kind === 'str')
    if (strList && !strict) return es.map((e, i) => ({ name: e.value, value: String(i + 1) }))
    if (!keyed) return null
    if (strict && !es.every((e) => e.kind === 'num' || e.kind === 'str' || (e.kind === 'table' && from.valueField)))
      return null
    const list: Member[] = []
    for (const e of es) {
      if (skip?.test(e.key!)) continue
      const value = e.kind === 'table' ? field(e, from.valueField) : e.kind === 'other' ? e.value.slice(0, 60) : e.value
      const desc =
        (e.kind === 'table' ? field(e, from.descField) : undefined) ?? trailingComment(text, masked, e.end, 'lua')
      list.push({
        name: e.key!,
        ...(value !== undefined ? { value } : {}),
        ...(desc ? { desc: desc.slice(0, 500) } : {}),
      })
    }
    return list
  }
  const put = (name: string, list: Member[]) => {
    if (enums[name]) warnings.push(t('{file} 里 {name} 定义了不止一次，只留第一个', { file, name }))
    else enums[name] = list
  }
  const ASSIGN = /(?<![\w.:])(?:local\s+)?([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*)\s*=\s*\{/g
  let pos = 0
  for (const m of masked.matchAll(ASSIGN)) {
    if ((m.index ?? 0) < pos) continue
    const full = m[1]
    const last = full.replace(/.*\./, '')
    const open = (m.index ?? 0) + m[0].length - 1
    const close = matchClose(masked, open)
    if (close < 0) continue
    if (from.container) {
      if (last !== from.container && full !== from.container) continue
      for (const e of luaEntries(masked, open, close)) {
        if (e.kind !== 'table' || !e.key || (nameRe && !nameRe.test(e.key))) continue
        const c = matchClose(masked, e.at)
        const list = c < 0 ? null : asEnum(e.at, c, false)
        if (list) put(e.key, list)
      }
      pos = close
      continue
    }
    if (nameRe ? nameRe.test(last) : true) {
      const list = asEnum(open, close, !nameRe)
      if (list) {
        put(last, list)
        pos = close
      }
    }
  }
  return { enums, warnings }
}

// ---------- 正则 ----------

export function scanRegex(text: string, from: Extract<CodeFrom, { kind: 'regex' }>, file: string): CodeScan {
  const enums: CodeScan['enums'] = {}
  const warnings: string[] = []
  const block = compileRe(from.block, 'gm')
  const member = compileRe(from.member, 'gm')
  const skip = compileRe(from.skip)
  if (!block || !member) throw new Error(t('正则写得不对或没填：枚举块和成员两个都要填'))
  for (const m of text.matchAll(block)) {
    const name = m.groups?.name?.trim()
    const body = m.groups?.body
    if (!name || body === undefined) throw new Error(t('枚举块的正则要有命名组 name 和 body：(?<name>…)、(?<body>…)'))
    const list: Member[] = []
    for (const x of body.matchAll(member)) {
      const n = x.groups?.name?.trim()
      if (!n) throw new Error(t('成员的正则要有命名组 name：(?<name>…)'))
      if (skip?.test(n)) continue
      const value = x.groups?.value?.trim()
      const desc = x.groups?.desc?.trim()
      list.push({
        name: n,
        ...(value ? { value: value.slice(0, 60) } : {}),
        ...(desc ? { desc: desc.slice(0, 500) } : {}),
      })
    }
    if (enums[name]) warnings.push(t('{file} 里 {name} 定义了不止一次，只留第一个', { file, name }))
    else enums[name] = list
  }
  return { enums, warnings }
}

/** 按写法扫一个文件 */
export function scanCode(text: string, from: CodeFrom, file: string): CodeScan {
  if (from.kind === 'cpp') return scanCpp(text, from, file)
  if (from.kind === 'lua') return scanLua(text, from, file)
  return scanRegex(text, from, file)
}
