/**
 * GameTest 项目接口的 Lua 部分（协议 8.2）：面板扫 api.lua 文件夹下的模块，模块表上的函数都算接口。
 * 参数、返回值照 EmmyLua 注释（---@param 名 类型 说明、---@return 类型 说明），---@readonly 算只读，
 * 函数上面不带 @ 的 --- 注释是说明。纯函数，不读文件（单测直接喂文本）。
 */

export interface LuaApiArg {
  name: string
  type?: string
  note?: string
}

export interface LuaApiItem {
  /** 项目.<模块名>.<函数名> */
  name: string
  /** require 路径（GameTestApi.QuestApi） */
  module: string
  function: string
  category?: string
  display?: string
  note?: string
  readOnly: boolean
  args: LuaApiArg[]
  returns?: string
  file: string
  line: number
}

export interface LuaApiRejected {
  module: string
  function: string
  file: string
  line: number
  why: string
}

const FN = [
  // function M.Name(a, b) / function M:Name(a)
  /^\s*function\s+([A-Za-z_][\w]*)\s*([.:])\s*([A-Za-z_][\w]*)\s*\(([^)]*)\)/,
  // M.Name = function(a, b)
  /^\s*([A-Za-z_][\w]*)\s*\.\s*([A-Za-z_][\w]*)\s*=\s*function\s*\(([^)]*)\)/,
]

/** 模块文件最后 return 的表名（return M）：只认这张表上的函数，局部辅助函数不算接口 */
function moduleTable(lines: string[]) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*return\s+([A-Za-z_][\w]*)\s*$/.exec(lines[i])
    if (m) return m[1]
    if (lines[i].trim() && !lines[i].trim().startsWith('--')) break
  }
  return undefined
}

/** 一个 Lua 模块文件 → 接口。module 是 require 路径，file 是相对项目根的路径（给接口库页跳转） */
export function parseLuaApi(text: string, module: string, file: string) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const table = moduleTable(lines)
  const items: LuaApiItem[] = []
  const rejected: LuaApiRejected[] = []
  const shortName = module.split('.').pop() ?? module
  lines.forEach((line, i) => {
    let tbl: string | undefined
    let fn: string | undefined
    let params = ''
    let colon = false
    const a = FN[0].exec(line)
    const b = a ? undefined : FN[1].exec(line)
    if (a) {
      tbl = a[1]
      colon = a[2] === ':'
      fn = a[3]
      params = a[4]
    } else if (b) {
      tbl = b[1]
      fn = b[2]
      params = b[3]
    }
    if (!tbl || !fn || (table && tbl !== table)) return
    // 函数上面连续的 --- 注释
    const doc: string[] = []
    for (let j = i - 1; j >= 0 && /^\s*---/.test(lines[j]); j--) doc.unshift(lines[j].replace(/^\s*---\s?/, ''))
    const declared = new Map<string, LuaApiArg>()
    let returns: string | undefined
    let readOnly = false
    let category: string | undefined
    let display: string | undefined
    const note: string[] = []
    for (const d of doc) {
      const p = /^@param\s+([\w.]+)(\??)\s+(\S+)\s*(.*)$/.exec(d)
      if (p) {
        declared.set(p[1], { name: p[1], type: p[3], note: p[4] || undefined })
        continue
      }
      const r = /^@return\s+(\S+)\s*(.*)$/.exec(d)
      if (r) {
        returns = r[1]
        continue
      }
      if (/^@readonly\b/.test(d)) {
        readOnly = true
        continue
      }
      const c = /^@category\s+(.+)$/.exec(d)
      if (c) {
        category = c[1].trim()
        continue
      }
      const n = /^@display\s+(.+)$/.exec(d)
      if (n) {
        display = n[1].trim()
        continue
      }
      if (!d.startsWith('@') && d.trim()) note.push(d.trim())
    }
    const names = params
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    if (fn.startsWith('_')) {
      rejected.push({ module, function: fn, file, line: i + 1, why: 'private' })
      return
    }
    if (names.includes('...')) {
      rejected.push({ module, function: fn, file, line: i + 1, why: 'varargs' })
      return
    }
    // 冒号定义的函数第一个参数是 self，调接口时不用传
    const args = (colon ? names : names.filter((x, k) => !(k === 0 && x === 'self'))).map(
      (x) => declared.get(x) ?? { name: x },
    )
    items.push({
      name: `项目.${shortName}.${fn}`,
      module,
      function: fn,
      category,
      display,
      note: note.join(' ') || undefined,
      readOnly,
      args,
      returns,
      file,
      line: i + 1,
    })
  })
  return { items, rejected }
}
