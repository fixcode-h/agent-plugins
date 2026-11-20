import { stat } from 'node:fs/promises'
import { comparable, opsFor, whyNotComparable } from '../../../shared/gt-script/ref/compare/index.ts'
import type { GtPropGroup, GtPropItem, GtPropKind } from '../../../shared/gt-script/ref/types.ts'
import { parseLuaModule, type LuaField } from '../gt-author/lua-parse.ts'
import { moduleFile, readLua, relToRoot } from '../gt-author/lua-files.ts'
import { t } from '../../util.ts'

/**
 * gt.props 的 Lua 字段（协议 game-test-ref 7.3、7.5）：UE 只按实例表给此刻有值的 Lua 字段，
 * 面板再按对象的 luaModule 找到源文件，用 lua-parse 读 `---@field`（以及 self.x、模块表字段）补全：
 * 还没赋值的、游戏没开时整组都靠这里，`@lua.` 的下拉才有东西可选。做法和 gt.vars 的 Lua 组一样（gt-author/lua-vars.ts）。
 */

/** 模块文件里声明的字段（没有这个文件、模块名不在脚本根里时 undefined） */
export interface LuaDeclared {
  /** 相对脚本根的文件 */
  file: string
  fields: LuaField[]
}

export async function luaDeclared(luaRootAbs: string, mod: string): Promise<LuaDeclared | undefined> {
  if (!mod.trim()) return undefined
  let abs: string
  try {
    abs = moduleFile(luaRootAbs, mod)
  } catch {
    return undefined
  }
  if (!(await stat(abs).catch(() => undefined))?.isFile()) return undefined
  return { file: relToRoot(luaRootAbs, abs), fields: parseLuaModule(await readLua(abs)).fields }
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
    prop: `@lua.${f.name}`,
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
 * 把声明合进 UE 回的组：Lua 字段放在 self 组（C++ → 蓝图 → Lua）末尾；UE 已经给了的（同名 @lua.）保留 UE 的值，
 * 只在它缺类型时补上声明的类型；没给的按声明补。没有 self 组（游戏没开、UE 太旧）时新建一个。
 * filter 和 gt.props 一样按名字子串筛
 */
export function mergeLuaProps(
  groups: GtPropGroup[],
  decl: LuaDeclared,
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
