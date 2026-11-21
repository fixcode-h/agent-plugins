import { stat } from 'node:fs/promises'
import { comparable, opsFor, whyNotComparable } from '../../../shared/gt-script/ref/compare/index.ts'
import type { GtPropGroup, GtPropItem, GtPropKind } from '../../../shared/gt-script/ref/types.ts'
import { parseLuaModule, type LuaField } from '../gt-author/lua-parse.ts'
import { moduleFile, readLua, relToRoot } from '../gt-author/lua-files.ts'
import { parseLuaHead } from './offline/lua-parents.ts'
import { t } from '../../util.ts'

/**
 * gt.props 的 Lua 字段（协议 game-test-ref 7.3、7.5）：UE 只按实例表给此刻有值的 Lua 字段，
 * 面板再按对象的 luaModule 找到源文件，用 lua-parse 读 `---@field`（以及 self.x、模块表字段）补全：
 * 还没赋值的、游戏没开时整组都靠这里，Lua 字段的下拉才有东西可选。做法和 gt.vars 的 Lua 组一样（gt-author/lua-vars.ts）。
 */

/** 模块文件里声明的字段（没有这个文件、模块名不在脚本根里时 undefined） */
export interface LuaDeclared {
  /** 相对脚本根的文件 */
  file: string
  fields: LuaField[]
  /** 函数（自己的和顺着父类继承来的），形状同 gt.props 的 functions 组：游戏没开时「方法」页靠它（用户 2026-11-21） */
  functions: { name: string; params: string[]; from?: string }[]
}

/** 往上找父类最多几层（防绕圈） */
const MAX_CHAIN = 8

export async function luaDeclared(luaRootAbs: string, mod: string): Promise<LuaDeclared | undefined> {
  const first = await readModule(luaRootAbs, mod)
  if (!first) return undefined
  // 函数顺着父类链收（子类覆盖的同名函数只留子类的），父类写法认 lua-parents.ts 那几种
  const functions: LuaDeclared['functions'] = []
  const seen = new Set<string>()
  const visited = new Set<string>()
  let cur: typeof first | undefined = first
  for (let level = 0; cur && level < MAX_CHAIN && !visited.has(cur.file); level++) {
    visited.add(cur.file)
    for (const f of cur.info.functions) {
      if (seen.has(f.name)) continue
      seen.add(f.name)
      functions.push({
        name: f.name,
        params: f.args.map((a) => a.name),
        ...(level ? { from: cur.mod } : {}),
      })
    }
    const parent: string | undefined = parseLuaHead(cur.text).parent
    cur = parent
      ? ((await readModule(luaRootAbs, parent)) ?? (await byRequire(luaRootAbs, cur.text, parent)))
      : undefined
  }
  return { file: first.file, fields: first.info.fields, functions }
}

/**
 * 注解里的父类常写类名（`---@class Child : Base`），不是模块路径：在这个文件 require 过的模块里找最后一段同名的
 * （`local Base = require "UI.Base"`），找到就读它
 */
async function byRequire(luaRootAbs: string, text: string, cls: string) {
  for (const m of text.matchAll(/require\s*\(?\s*["']([^"']+)["']/g)) {
    const mod = m[1]
    if (mod.split(/[./\\]/).pop() === cls) return readModule(luaRootAbs, mod)
  }
  return undefined
}

/** 模块名（点或 / 分隔，可带开头的 /）→ 源文件和解析结果；不在脚本根里、没有这个文件时 undefined */
async function readModule(luaRootAbs: string, rawMod: string) {
  const mod = rawMod.trim().replace(/^[/\\]+/, '')
  if (!mod) return undefined
  let abs: string
  try {
    abs = moduleFile(luaRootAbs, mod)
  } catch {
    return undefined
  }
  if (!(await stat(abs).catch(() => undefined))?.isFile()) return undefined
  const text = await readLua(abs)
  return { mod, file: relToRoot(luaRootAbs, abs), text, info: parseLuaModule(text) }
}

/**
 * 注释里的类型 → 比较表的 kind（协议 7.5）：number / integer、string、boolean、table / X[]；
 * 别的（类名、联合类型、any）要看运行时的值，声明里给不出 → undefined
 */
export function luaKind(type: string): GtPropKind | undefined {
  const t = type
    .trim()
    .replace(/\?$/, '')
    .replace(/\s*\|\s*nil$/, '')
  if (/\[\]$/.test(t) || /^table(<.*>)?$/.test(t)) return 'array'
  switch (t) {
    case 'number':
      return 'float'
    case 'integer':
      return 'int'
    case 'string':
      return 'string'
    case 'boolean':
      return 'bool'
  }
  return undefined
}

const srcNote = (k: LuaField['kind']) =>
  k === 'field' ? t('---@field 声明') : k === 'self' ? t('方法里的 self 赋值') : t('模块表字段')

/** 一个声明 → 属性树的一项：只有声明（实例表里没有）的带 note，写清楚来源和行号 */
function declaredItem(f: LuaField, file: string): GtPropItem {
  const kind = luaKind(f.type)
  const item: GtPropItem = {
    prop: `@#${f.name}`,
    name: f.name,
    src: 'lua',
    type: f.type,
    kind: kind ?? 'none',
  }
  const where = `${file}:${f.line}（${srcNote(f.kind)}）`
  item.note = [
    f.note,
    kind
      ? t('只在源码里看到，此刻实例表里没有值：{where}', { where })
      : t('类型 {type} 要看运行时的值，开着游戏再选：{where}', { type: f.type, where }),
  ]
    .filter(Boolean)
    .join('；')
  if (kind && comparable(kind)) item.ops = opsFor(kind)
  else {
    item.comparable = false
    item.why = kind ? whyNotComparable(kind) : t('Lua 类型 {type} 不知道怎么比', { type: f.type })
  }
  return item
}

/**
 * 把声明合进 UE 回的组：Lua 字段放在 self 组（C++ → 蓝图 → Lua）末尾；UE 已经给了的（同名 @#）保留 UE 的值，
 * 只在它缺类型时补上声明的类型；没给的按声明补。没有 self 组（游戏没开、UE 太旧）时新建一个。
 * filter 和 gt.props 一样按名字子串筛
 */
export function mergeLuaProps(
  groups: GtPropGroup[],
  decl: Pick<LuaDeclared, 'file' | 'fields'>,
  o: { filter?: string; selfTitle: string },
): { groups: GtPropGroup[]; added: number } {
  const f = (o.filter ?? '').toLowerCase()
  const out = groups.map((g) => ({ ...g, items: g.items.map((x) => ({ ...x })) }))
  let self = out.find((g) => g.id === 'self')
  if (!self) {
    self = { id: 'self', title: o.selfTitle, items: [] }
    out.unshift(self)
  }
  const have = new Map(self.items.filter((x) => x.src === 'lua').map((x) => [x.name, x]))
  let added = 0
  const seen = new Set<string>()
  for (const d of decl.fields) {
    if (seen.has(d.name) || (f && !d.name.toLowerCase().includes(f))) continue
    seen.add(d.name)
    const live = have.get(d.name)
    if (live) {
      if (!live.type || live.type === 'any') live.type = d.type
      continue
    }
    self.items.push(declaredItem(d, decl.file))
    added++
  }
  return { groups: out, added }
}
