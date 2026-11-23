import { stat } from 'node:fs/promises'
import { parseLuaModule, type LuaModuleInfo } from './lua-parse.ts'
import { luaChain } from '../gt-ref/lua-props.ts'
import { moduleFile, readLua, relToRoot } from './lua-files.ts'

/**
 * gt.vars 的 Lua 组（GameTest 脚本协议 10 节、定稿 9.4 / 9.5）：游戏没开时 UE 给不出 Lua 实例表，由面板按模块文件扫出
 * `---@field`、`self.x = …`、模块表字段和函数，和 UE 回的 C++ / 蓝图组拼在一起，组结构一样（src: "lua"，每项带行号）。
 * 游戏开着时 UE 按实例表给了 Lua 组，就拿它的值补到文件扫出的项上（文件里有、实例表里没有的也留着，标「还没赋值」）。
 */
export interface VarItem {
  name: string
  path: string
  type: string
  kind: 'prop' | 'fn'
  readOnly: boolean
  sig?: string
  args?: { name: string; type: string; constructible: boolean; note?: string; out?: boolean; object?: boolean }[]
  note?: string
  /** C++ 属性的 UPROPERTY Category（离线读头文件时有，gt-ref/offline/cpp-members.ts） */
  cat?: string
  line?: number
  value?: unknown
  dim?: boolean
}

export interface VarGroup {
  src: 'cpp' | 'bp' | 'lua'
  title: string
  file?: string
  items: VarItem[]
  [k: string]: unknown
}

/** 像动画、计时的字段：列表里默认收起变灰（和 UE 回的 dim 同一条规则） */
const DIM = /anim|time|tick|hover|timer|tween/i
const CONSTRUCTIBLE = /^(integer|number|string|boolean|int|float|bool|any|table)\??$/

/**
 * prefix：字段在条件里怎么写。界面绑的 Lua 实例是 `@#`（属性路径 v5，配 obj）；模块表是 `@luaMod.<require 路径>.`
 */
export async function luaGroup(root: string, mod: string, prefix: string, filter = ''): Promise<VarGroup | undefined> {
  let abs: string
  try {
    abs = moduleFile(root, mod)
  } catch {
    return undefined
  }
  if (!(await stat(abs).catch(() => undefined))?.isFile()) return undefined
  const items = luaItems(parseLuaModule(await readLua(abs)), prefix, filter)
  return { src: 'lua', title: relToRoot(root, abs), file: relToRoot(root, abs), items }
}

/** 解析结果 → 组里的项：字段在前、函数在后（下划线开头的私有函数不列） */
function luaItems(info: LuaModuleInfo, prefix: string, filter = ''): VarItem[] {
  const f = filter.toLowerCase()
  const keep = (name: string) => !f || name.toLowerCase().includes(f)
  return [
    ...info.fields
      .filter((x) => keep(x.name))
      .map(
        (x): VarItem => ({
          name: x.name,
          path: `${prefix}${x.name}`,
          type: x.type,
          kind: 'prop',
          readOnly: false,
          line: x.line,
          ...(x.note ? { note: x.note } : {}),
          ...(DIM.test(x.name) ? { dim: true } : {}),
        }),
      ),
    ...info.functions
      .filter((x) => keep(x.name) && !x.name.startsWith('_'))
      .map(
        (x): VarItem => ({
          name: x.name,
          path: `${prefix}${x.name}`,
          type: x.returns || 'nil',
          kind: 'fn',
          // 只读要作者在注释里标 ---@readonly：Lua 看不出函数改不改状态，条件和表达式里只许调只读的
          readOnly: x.readOnly,
          sig: `${x.method ? ':' : '.'}${x.name}(${x.args.map((a) => `${a.name}: ${a.type}`).join(', ')})${x.returns ? ` → ${x.returns}` : ''}`,
          args: x.args.map((a) => ({
            name: a.name,
            type: a.type,
            constructible: CONSTRUCTIBLE.test(a.type),
            ...(a.note ? { note: a.note } : {}),
          })),
          line: x.line,
          ...(x.note ? { note: x.note } : {}),
        }),
      ),
  ]
}

/**
 * Lua 类连同父类的各层，一层一组（组名是模块名，方法页按它分组）；子类已经有的同名字段、函数不在父类组里重复。
 * GM 对象调用里「只按类」的 Lua 对象 UE 没连上时靠它列成员（用户 2026-11-23：编辑器没开也该读得到 Lua 的函数和成员变量）
 */
export async function luaChainGroups(root: string, mod: string): Promise<VarGroup[]> {
  const seen = new Set<string>()
  const out: VarGroup[] = []
  for (const level of await luaChain(root, mod)) {
    const items = luaItems(level.info, '@.').filter((x) => !seen.has(x.name))
    for (const x of items) seen.add(x.name)
    // 组名只留最后一段（SM_HD_HomeDecoration），全路径在 file 里
    const name =
      level.mod
        .split(/[./\\]/)
        .filter(Boolean)
        .at(-1) ?? level.mod
    if (items.length) out.push({ src: 'lua', title: name, class: name, file: level.file, items })
  }
  return out
}

/** 文件扫出的组 + UE 按实例表给的组：按名字带上此刻的值；只在实例表里的（动态加的字段）补在后面 */
export function mergeLuaGroups(fromFile: VarGroup | undefined, fromGame: VarGroup | undefined): VarGroup | undefined {
  if (!fromFile) return fromGame
  if (!fromGame) return fromFile
  const live = new Map(fromGame.items.map((x) => [x.name, x]))
  const items = fromFile.items.map((x) => {
    const g = live.get(x.name)
    live.delete(x.name)
    return g && 'value' in g ? { ...x, value: g.value } : x
  })
  return { ...fromGame, ...fromFile, items: [...items, ...live.values()] }
}
