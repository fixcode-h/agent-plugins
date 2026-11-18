import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { within } from './gt-paths.ts'

/**
 * 代码变量弹窗的 Lua 组（定稿 9.5）：游戏没开时由面板扫 Lua 文件——`---@field 名 类型 说明`、`self.xxx =`（含 self.a.b =）、
 * 模块表上的字段（M.xxx =），带行号。类型靠注释推断，没注释时按赋的值猜（数字、字符串、true/false、{}）。
 * 返回和 gt.vars 的 groups 同一种形状（src: "lua"），网页按名字和游戏开着时给的实例值合并
 */
export interface LuaFieldItem {
  name: string
  path: string
  type?: string
  note?: string
  line: number
  kind: 'prop'
  readOnly: true
}

function guessType(v: string) {
  const s = v.trim()
  if (/^-?\d/.test(s)) return 'number'
  if (/^["']/.test(s)) return 'string'
  if (/^(true|false)\b/.test(s)) return 'boolean'
  if (s.startsWith('{')) return 'table'
  return undefined
}

export function parseLuaFields(text: string): LuaFieldItem[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const out = new Map<string, LuaFieldItem>()
  const add = (path: string, line: number, type?: string, note?: string) => {
    const old = out.get(path)
    if (old) {
      // ---@field 先出现时说明和类型以注释为准，赋值只补行号以外的空缺
      old.type ??= type
      old.note ??= note
      return
    }
    out.set(path, { name: path.split('.').pop() ?? path, path, type, note, line, kind: 'prop', readOnly: true })
  }
  lines.forEach((l, i) => {
    const f = /^\s*---@field\s+(?:public\s+|private\s+|protected\s+)?([\w]+)\??\s+(\S+)\s*(.*)$/.exec(l)
    if (f) return add(`self.${f[1]}`, i + 1, f[2], f[3] || undefined)
    const s = /^\s*self\s*\.\s*([\w.]+)\s*=(?!=)\s*(.*)$/.exec(l)
    if (s) {
      const prev = lines[i - 1]?.match(/^\s*---?\s*(?!@)(.+)$/)?.[1]
      const tail = s[2].match(/--\s*(.+)$/)?.[1]
      return add(`self.${s[1]}`, i + 1, guessType(s[2]), (tail ?? prev)?.trim() || undefined)
    }
    const m = /^\s*([A-Z]\w*)\s*\.\s*([\w]+)\s*=(?!=)\s*(?!function)(.*)$/.exec(l)
    if (m) add(`${m[1]}.${m[2]}`, i + 1, guessType(m[3]))
  })
  return [...out.values()]
}

/** 按 require 路径（UI.Guide.GuidePanel）读 Lua 脚本根下的文件 */
export async function luaFields(p: UeProject, module: string) {
  const scriptRoot = path.resolve(p.root, p.luaBuild?.scriptDir || 'Content/Script')
  const rel = module.replace(/\./g, '/') + '.lua'
  const abs = path.resolve(scriptRoot, rel)
  if (!within(scriptRoot, abs)) throw new Error(t('只能读 Lua 脚本根里的文件：{m}', { m: module }))
  const text = await readFile(abs, 'utf8').catch(() => undefined)
  if (text === undefined) return { module, file: undefined, items: [] }
  return { module, file: path.relative(p.root, abs).replace(/\\/g, '/'), items: parseLuaFields(text) }
}
