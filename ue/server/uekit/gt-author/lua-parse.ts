/**
 * 不跑 Lua、只看源码，认出一个 Lua 模块里 GameTest 用得上的东西（纯函数，不 import node 模块）：
 * - 字段：`---@field 名 类型 说明`、方法里的 `self.名 = …`、模块表上的 `M.名 = …` 和 `local M = { 名 = … }` 里的键；
 * - 函数：`function M.Fn(a, b)`、`function M:Fn(a)`、`M.Fn = function(a)`，连同上面紧挨着的 EmmyLua 注释
 *   （`---@param 名 类型 说明`、`---@return 类型 说明`、`---@readonly`，其余注释行是说明）。
 *
 * 用在两处（GameTest 脚本协议第 8.2、9.5 节）：gt.vars 的 Lua 组（游戏没开时按文件给出字段，游戏开着由 UE 按实例表补值），
 * 和 _api.json 的 lua 段（项目接口）。
 *
 * 不按某一种 UnLua 的写法认模块（用户的 UnLua 是二次开发版）：模块表就是文件最后一句顶层 `return X` 的 X，
 * 没有 return 时取 `function X.` / `function X:` 里出现最多的那个名字。认不全的写法宁可漏，不编。
 */
export interface LuaField {
  name: string
  /** 注释写的类型，或按赋值的字面量推断（number / string / boolean / table），推不出来是 any */
  type: string
  /** field：---@field；self：方法里 self.x = …；module：模块表上的 M.x = … 或表构造里的键 */
  kind: 'field' | 'self' | 'module'
  line: number
  note?: string
}

export interface LuaArg {
  name: string
  type: string
  note?: string
}

export interface LuaFunction {
  name: string
  /** function M:Fn（第一个参数是 self） */
  method: boolean
  args: LuaArg[]
  returns: string
  readOnly: boolean
  line: number
  note?: string
}

export interface LuaModuleInfo {
  /** 模块表的局部变量名；认不出来时为空，这时只有 ---@field 能列出来 */
  table: string
  fields: LuaField[]
  functions: LuaFunction[]
}

const IDENT = '[A-Za-z_][\\w]*'

/** 去掉一行代码里的行尾注释（不在字符串里的 --），长注释和长字符串由调用方按行跳过 */
function stripComment(line: string) {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '-' && line[i + 1] === '-') return line.slice(0, i)
  }
  return line
}

/** 赋值右边是字面量时推类型：给 Agent 看个大概，写条件时知道该和数字比还是和文字比 */
export function literalType(rhs: string): string {
  const v = rhs.trim().replace(/[,;]\s*$/, '')
  if (/^-?(0x[\da-f]+|\d+(\.\d*)?(e[+-]?\d+)?)$/i.test(v)) return 'number'
  if (/^(["']).*\1$/.test(v) || /^\[=*\[/.test(v)) return 'string'
  if (v === 'true' || v === 'false') return 'boolean'
  if (v.startsWith('{')) return 'table'
  return 'any'
}

interface Doc {
  params: Map<string, { type: string; note?: string }>
  returns: string[]
  readOnly: boolean
  note: string[]
}

const emptyDoc = (): Doc => ({ params: new Map(), returns: [], readOnly: false, note: [] })

/** 一行注释（已去掉开头的 -- / ---）记进紧挨着下一段代码的说明 */
function readDocLine(doc: Doc, text: string, fields: LuaField[], line: number) {
  const tag = text.match(/^@(\w+)\s*(.*)$/)
  if (!tag) {
    const s = text.trim()
    // 分隔线、空注释不算说明
    if (s && !/^[-=*#\s]+$/.test(s)) doc.note.push(s)
    return
  }
  const [, name, rest] = tag
  if (name === 'param') {
    const m = rest.match(new RegExp(`^(${IDENT}|\\.\\.\\.)(\\??)\\s+(\\S+)\\s*(.*)$`))
    if (m) doc.params.set(m[1], { type: m[3] + (m[2] ? '?' : ''), ...(m[4].trim() ? { note: m[4].trim() } : {}) })
  } else if (name === 'return') {
    const m = rest.match(/^(\S+)/)
    if (m) doc.returns.push(m[1])
  } else if (name === 'readonly') doc.readOnly = true
  else if (name === 'field') {
    // ---@field [public|protected|private] 名 类型 说明
    const m = rest.match(new RegExp(`^(?:(?:public|protected|private|package)\\s+)?(${IDENT})(\\??)\\s+(\\S+)\\s*(.*)$`))
    if (m && !fields.some((f) => f.name === m[1]))
      fields.push({
        name: m[1],
        type: m[3] + (m[2] ? '?' : ''),
        kind: 'field',
        line,
        ...(m[4].trim() ? { note: m[4].trim() } : {}),
      })
  }
}

function parseArgs(list: string, doc: Doc): LuaArg[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      const d = doc.params.get(name)
      return { name, type: d?.type ?? 'any', ...(d?.note ? { note: d.note } : {}) }
    })
}

/** 模块表名：最后一句顶层 return X；没有就按 function X. / X: 出现最多的 */
function moduleTable(lines: string[]) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim()
    if (!s) continue
    const m = s.match(new RegExp(`^return\\s+(${IDENT})\\s*;?$`))
    if (m) return m[1]
    if (/^return\b/.test(s)) break
    // 文件末尾的空行、注释之外第一句不是 return：没有模块返回
    if (!s.startsWith('--')) break
  }
  const count = new Map<string, number>()
  for (const l of lines) {
    const m = l.match(new RegExp(`^\\s*function\\s+(${IDENT})[.:]`))
    if (m) count.set(m[1], (count.get(m[1]) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** 跳过长注释 --[[ … ]] / --[==[ … ]==] 和长字符串里的行：返回每行是不是代码 */
function codeMask(lines: string[]) {
  const mask: boolean[] = []
  let close = ''
  for (const l of lines) {
    if (close) {
      mask.push(false)
      if (l.includes(close)) close = ''
      continue
    }
    mask.push(true)
    const m = l.match(/--\[(=*)\[/) ?? l.match(/=\s*\[(=*)\[/)
    if (m) {
      const end = `]${m[1]}]`
      if (!l.slice(l.indexOf(m[0]) + m[0].length).includes(end)) close = end
    }
  }
  return mask
}

export function parseLuaModule(text: string): LuaModuleInfo {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const mask = codeMask(lines)
  const table = moduleTable(lines)
  const fields: LuaField[] = []
  const functions: LuaFunction[] = []
  const seenField = (name: string) => fields.some((f) => f.name === name)
  let doc = emptyDoc()
  /** 正在读的方法（function M:Fn）：里面的 self.x = … 才算实例字段；按缩进为 0 的 end 结束 */
  let inMethod = false
  /** local M = { … } 表构造里的嵌套深度：只认第一层的键 */
  let ctorDepth = 0

  const tbl = table.replace(/[$]/g, '\\$')
  const reFn = table ? new RegExp(`^function\\s+${tbl}([.:])(${IDENT})\\s*\\(([^)]*)\\)`) : null
  const reFnAssign = table ? new RegExp(`^${tbl}\\.(${IDENT})\\s*=\\s*function\\s*\\(([^)]*)\\)`) : null
  const reModField = table ? new RegExp(`^${tbl}\\.(${IDENT})\\s*=\\s*(.+)$`) : null
  const reCtor = table ? new RegExp(`^local\\s+${tbl}\\s*=\\s*\\{(.*)$`) : null

  lines.forEach((raw, i) => {
    const line = i + 1
    if (!mask[i]) return
    const trimmed = raw.trim()
    const docLine = trimmed.match(/^---?(?!\[)\s?(.*)$/)
    if (docLine) {
      readDocLine(doc, docLine[1], fields, line)
      return
    }
    const code = stripComment(raw)
    const s = code.trim()
    if (!s) {
      doc = emptyDoc()
      return
    }
    const top = !/^\s/.test(code)

    if (ctorDepth > 0) {
      if (ctorDepth === 1) {
        const m = s.match(new RegExp(`^(${IDENT})\\s*=\\s*(.*)$`))
        if (m && !seenField(m[1]))
          fields.push({ name: m[1], type: literalType(m[2]), kind: 'module', line, ...noteOf(doc) })
      }
      ctorDepth += (s.match(/\{/g)?.length ?? 0) - (s.match(/\}/g)?.length ?? 0)
      doc = emptyDoc()
      return
    }

    const fn = reFn && top ? s.match(reFn) : null
    const fa = !fn && reFnAssign && top ? s.match(reFnAssign) : null
    if (fn || fa) {
      const method = !!fn && fn[1] === ':'
      const name = fn ? fn[2] : fa![1]
      const args = parseArgs(fn ? fn[3] : fa![2], doc)
      functions.push({
        name,
        method,
        args,
        returns: doc.returns.join(', '),
        readOnly: doc.readOnly,
        line,
        ...noteOf(doc),
      })
      inMethod = method
      doc = emptyDoc()
      return
    }
    if (top && /^end\b/.test(s)) inMethod = false
    else if (top && /^(local\s+)?function\b/.test(s)) inMethod = false

    const ctor = reCtor && top ? s.match(reCtor) : null
    if (ctor) {
      const rest = ctor[1]
      ctorDepth = 1 + (rest.match(/\{/g)?.length ?? 0) - (rest.match(/\}/g)?.length ?? 0)
      // 一行写完的 { a = 1, b = 2 }：逐个键认
      if (ctorDepth <= 0) {
        for (const m of rest.matchAll(new RegExp(`(?:^|,)\\s*(${IDENT})\\s*=\\s*([^,}]+)`, 'g')))
          if (!seenField(m[1])) fields.push({ name: m[1], type: literalType(m[2]), kind: 'module', line })
        ctorDepth = 0
      }
      doc = emptyDoc()
      return
    }

    const mf = reModField && top ? s.match(reModField) : null
    if (mf) {
      if (!seenField(mf[1])) fields.push({ name: mf[1], type: literalType(mf[2]), kind: 'module', line, ...noteOf(doc) })
      doc = emptyDoc()
      return
    }

    if (inMethod) {
      // 一行里可能有几处 self.x = …（a and b 的写法少见，按第一处算）
      const m = s.match(new RegExp(`(?:^|[^\\w.])self\\.(${IDENT})\\s*=(?!=)\\s*(.*)$`))
      if (m && !seenField(m[1])) fields.push({ name: m[1], type: literalType(m[2]), kind: 'self', line, ...noteOf(doc) })
    }
    doc = emptyDoc()
  })
  return { table, fields, functions }
}

function noteOf(doc: Doc) {
  const note = doc.note.join(' ').trim()
  return note ? { note } : {}
}
