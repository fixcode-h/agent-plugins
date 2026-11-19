/**
 * 表达式（协议第 3 节）的词法和语法：面板的表达式框靠它当场标出写错的位置、给补全，离线校验也用它查语法和引用。
 * 只管「写得对不对、用到了什么」，不求值（求值在 GameTest 里，要读游戏）。
 * 出错返回错误码和位置，文案由界面按错误码翻译（这一层不依赖面板宿主）。
 */

export const EXPR_MAX = 1000

export type ExprNode =
  | { k: 'num'; v: number; at: number }
  | { k: 'str'; v: string; at: number }
  | { k: 'lit'; v: boolean | null; at: number }
  | { k: 'arr'; items: ExprNode[]; at: number }
  | { k: 'obj'; entries: { key: string; value: ExprNode }[]; at: number }
  /** $名字 */
  | { k: 'var'; name: string; at: number }
  /** @来源（gi、sub、actor[tag=X]、luaMod、cvar…），后面的 .成员 是 member 节点 */
  | { k: 'src'; name: string; at: number }
  /** 函数名或接口名的开头（text、Object） */
  | { k: 'id'; name: string; at: number }
  | { k: 'member'; obj: ExprNode; name: string; at: number }
  | { k: 'index'; obj: ExprNode; index: ExprNode; at: number }
  | { k: 'call'; callee: ExprNode; args: ExprNode[]; at: number }
  | { k: 'unary'; op: string; x: ExprNode; at: number }
  | { k: 'bin'; op: string; a: ExprNode; b: ExprNode; at: number }
  | { k: 'cond'; test: ExprNode; a: ExprNode; b: ExprNode; at: number }

export type ExprErrorCode =
  | 'empty'
  | 'too_long'
  | 'bad_char'
  | 'unterminated_string'
  | 'unexpected'
  | 'expected'
  | 'unexpected_end'

export interface ExprError {
  code: ExprErrorCode
  /** 出错的字符位置（从 0） */
  at: number
  /** expected 时：期望的符号；unexpected 时：碰到的符号 */
  token?: string
}

interface Tok {
  t: 'num' | 'str' | 'var' | 'src' | 'id' | 'op' | 'end'
  v: string
  at: number
}

const OPS = [
  '==',
  '!=',
  '>=',
  '<=',
  '>',
  '<',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '.',
  '?',
  ':',
]
const IDENT = /[A-Za-z_一-鿿][\w一-鿿]*/y

class Fail extends Error {
  e: ExprError
  constructor(e: ExprError) {
    super(e.code)
    this.e = e
  }
}

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const at = i
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.?/y
      m.lastIndex = i
      const v = m.exec(src)![0]
      out.push({ t: 'num', v, at })
      i += v.length
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let v = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1]
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n
          j += 2
        } else v += src[j++]
      }
      if (j >= src.length) throw new Fail({ code: 'unterminated_string', at })
      out.push({ t: 'str', v, at })
      i = j + 1
      continue
    }
    if (c === '$' || c === '@') {
      IDENT.lastIndex = i + 1
      const m = IDENT.exec(src)
      if (!m) throw new Fail({ code: 'bad_char', at, token: c })
      let v = m[0]
      i = i + 1 + v.length
      // @actor[tag=X] / @actor[class=BP_X] 的方括号是来源的一部分，里面的 = 不是运算符
      if (c === '@' && src[i] === '[' && /^[A-Za-z_]+=/.test(src.slice(i + 1))) {
        const end = src.indexOf(']', i)
        if (end < 0) throw new Fail({ code: 'expected', at: src.length, token: ']' })
        v += src.slice(i, end + 1)
        i = end + 1
      }
      out.push({ t: c === '$' ? 'var' : 'src', v, at })
      continue
    }
    IDENT.lastIndex = i
    const id = IDENT.exec(src)
    if (id) {
      out.push({ t: 'id', v: id[0], at })
      i += id[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new Fail({ code: 'bad_char', at, token: c })
    out.push({ t: 'op', v: op, at })
    i += op.length
  }
  out.push({ t: 'end', v: '', at: src.length })
  return out
}

/** 二元运算的优先级（数字大的先算）。or / and / in 是关键字 */
const BIN: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 4,
  '!=': 4,
  '>': 4,
  '>=': 4,
  '<': 4,
  '<=': 4,
  in: 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

function parser(toks: Tok[]) {
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const isOp = (v: string) => peek().t === 'op' && peek().v === v
  const expect = (v: string) => {
    if (!isOp(v)) {
      const tk = peek()
      throw new Fail(
        tk.t === 'end' ? { code: 'unexpected_end', at: tk.at, token: v } : { code: 'expected', at: tk.at, token: v },
      )
    }
    return next()
  }
  const binOp = () => {
    const tk = peek()
    if (tk.t === 'op' && tk.v in BIN) return tk.v
    if (tk.t === 'id' && (tk.v === 'or' || tk.v === 'and' || tk.v === 'in')) return tk.v
    return undefined
  }

  function list(close: string): ExprNode[] {
    const items: ExprNode[] = []
    if (isOp(close)) {
      next()
      return items
    }
    for (;;) {
      items.push(ternary())
      if (isOp(',')) {
        next()
        continue
      }
      expect(close)
      return items
    }
  }

  function primary(): ExprNode {
    const tk = next()
    switch (tk.t) {
      case 'num':
        return { k: 'num', v: Number(tk.v), at: tk.at }
      case 'str':
        return { k: 'str', v: tk.v, at: tk.at }
      case 'var':
        return { k: 'var', name: tk.v, at: tk.at }
      case 'src':
        return { k: 'src', name: tk.v, at: tk.at }
      case 'id':
        if (tk.v === 'true' || tk.v === 'false') return { k: 'lit', v: tk.v === 'true', at: tk.at }
        if (tk.v === 'null') return { k: 'lit', v: null, at: tk.at }
        if (tk.v === 'not') return { k: 'unary', op: 'not', x: unary(), at: tk.at }
        return { k: 'id', name: tk.v, at: tk.at }
      case 'op':
        if (tk.v === '(') {
          const x = ternary()
          expect(')')
          return x
        }
        if (tk.v === '[') return { k: 'arr', items: list(']'), at: tk.at }
        if (tk.v === '{') {
          const entries: { key: string; value: ExprNode }[] = []
          if (!isOp('}'))
            for (;;) {
              const key = next()
              if (key.t !== 'str' && key.t !== 'id') throw new Fail({ code: 'unexpected', at: key.at, token: key.v })
              expect(':')
              entries.push({ key: key.v, value: ternary() })
              if (isOp(',')) {
                next()
                continue
              }
              break
            }
          expect('}')
          return { k: 'obj', entries, at: tk.at }
        }
        throw new Fail({ code: 'unexpected', at: tk.at, token: tk.v })
      default:
        throw new Fail({ code: 'unexpected_end', at: tk.at })
    }
  }

  function postfix(): ExprNode {
    let x = primary()
    for (;;) {
      const tk = peek()
      if (tk.t !== 'op') return x
      if (tk.v === '.') {
        next()
        const name = next()
        if (name.t !== 'id') throw new Fail({ code: 'unexpected', at: name.at, token: name.v })
        x = { k: 'member', obj: x, name: name.v, at: name.at }
      } else if (tk.v === '[') {
        next()
        const index = ternary()
        expect(']')
        x = { k: 'index', obj: x, index, at: tk.at }
      } else if (tk.v === '(') {
        next()
        x = { k: 'call', callee: x, args: list(')'), at: tk.at }
      } else return x
    }
  }

  function unary(): ExprNode {
    const tk = peek()
    if (tk.t === 'op' && tk.v === '-') {
      next()
      return { k: 'unary', op: '-', x: unary(), at: tk.at }
    }
    if (tk.t === 'id' && tk.v === 'not') {
      next()
      return { k: 'unary', op: 'not', x: unary(), at: tk.at }
    }
    return postfix()
  }

  function binary(min: number): ExprNode {
    let a = unary()
    for (;;) {
      const op = binOp()
      if (!op || BIN[op] < min) return a
      const at = next().at
      a = { k: 'bin', op, a, b: binary(BIN[op] + 1), at }
    }
  }

  function ternary(): ExprNode {
    const test = binary(1)
    if (!isOp('?')) return test
    const at = next().at
    const a = ternary()
    expect(':')
    return { k: 'cond', test, a, b: ternary(), at }
  }

  return {
    parse() {
      const x = ternary()
      const tk = peek()
      if (tk.t !== 'end') throw new Fail({ code: 'unexpected', at: tk.at, token: tk.v })
      return x
    },
  }
}

/** 解析一条表达式（不带开头的 `=`）。值里的 `"=…"` 用 exprOfValue 取出来再解析 */
export function parseExpr(src: string): { ast: ExprNode } | { error: ExprError } {
  if (!src.trim()) return { error: { code: 'empty', at: 0 } }
  if (src.length > EXPR_MAX) return { error: { code: 'too_long', at: EXPR_MAX } }
  try {
    return { ast: parser(lex(src)).parse() }
  } catch (e) {
    if (e instanceof Fail) return { error: e.e }
    throw e
  }
}

/** 填值的地方：以 `=` 开头的字符串是表达式，`\=` 开头是真的等号开头的文字 */
export function exprOfValue(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.startsWith('=')) return undefined
  return v.slice(1)
}

/** 点号连起来的名字（Object.Count、text）：调用的是谁；不是纯名字链时 undefined */
export function dottedName(n: ExprNode): string | undefined {
  if (n.k === 'id') return n.name
  if (n.k === 'member') {
    const base = dottedName(n.obj)
    return base ? `${base}.${n.name}` : undefined
  }
  return undefined
}

/** 表达式里用到了什么：$变量、@来源（只取来源名，不含路径）、调用的函数 / 接口名（含 @来源上的 .Fn） */
export interface ExprRefs {
  vars: Set<string>
  sources: Set<string>
  calls: { name: string; at: number; onSource?: boolean }[]
  /** 单独出现、没被调用的名字（多半是忘了加 $ 的变量） */
  bareIds: { name: string; at: number }[]
}

export function refsOf(ast: ExprNode): ExprRefs {
  const r: ExprRefs = { vars: new Set(), sources: new Set(), calls: [], bareIds: [] }
  const visit = (n: ExprNode) => {
    switch (n.k) {
      case 'var':
        r.vars.add(n.name)
        return
      case 'src':
        r.sources.add(n.name.replace(/\[.*$/, ''))
        return
      case 'id':
        r.bareIds.push({ name: n.name, at: n.at })
        return
      case 'arr':
        n.items.forEach(visit)
        return
      case 'obj':
        n.entries.forEach((e) => visit(e.value))
        return
      case 'member':
        visit(n.obj)
        return
      case 'index':
        visit(n.obj)
        visit(n.index)
        return
      case 'call': {
        // 纯名字链（text、Object.Count）是内置函数或接口；@来源.Fn()、$变量.Fn() 是对象上的只读函数
        const name = dottedName(n.callee)
        if (name) r.calls.push({ name, at: n.at })
        else if (n.callee.k === 'member') {
          r.calls.push({ name: n.callee.name, at: n.at, onSource: true })
          visit(n.callee.obj)
        } else visit(n.callee)
        n.args.forEach(visit)
        return
      }
      case 'unary':
        visit(n.x)
        return
      case 'bin':
        visit(n.a)
        visit(n.b)
        return
      case 'cond':
        visit(n.test)
        visit(n.a)
        visit(n.b)
        return
      default:
        return
    }
  }
  visit(ast)
  return r
}

/**
 * 补全用：光标前正在写的那个词（$变量、@来源、函数名，含点号链），以及它从哪开始。
 * 在字符串里时不补
 */
export function wordAt(src: string, caret: number): { word: string; from: number } | undefined {
  let inStr: string | undefined
  for (let i = 0; i < caret; i++) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === inStr) inStr = undefined
    } else if (c === '"' || c === "'") inStr = c
  }
  if (inStr) return undefined
  const m = /[$@]?[\w一-鿿.]*$/.exec(src.slice(0, caret))
  if (!m || !m[0]) return undefined
  return { word: m[0], from: caret - m[0].length }
}
