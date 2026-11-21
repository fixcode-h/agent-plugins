import type { LuaGmBinding, LuaGmConfig, LuaGmItem, LuaGmParam } from '../../../server/lua-gm/types.ts'
import { isEngineOwner as isEngine } from '../../../shared/gm/engine.ts'
import { customKey, type GmCustom } from '../../../shared/gm/schema.ts'

/**
 * GM 页（设计稿 designs/GM页重设计-效果图）：C++ GM（桥接 gm.list）和 Lua GM（扫描脚本）合成一张表。
 * 来源分三种：Lua、项目的 C++、引擎自带（CheatManager、PlayerController 这些类上的 Exec 函数，默认不显示）
 */

/** 桥接 gm.list 的一条 */
export interface CppGm {
  name: string
  owner: string
  category: string
  tooltip: string
  source: string
  server: boolean
  params: { name: string; type: string; out?: boolean; enum?: string[] }[]
}

/** 来源：Lua、项目的 C++、引擎自带、自定义（对象调用保存的）、控制台命令（引擎分类里，收藏和用过的） */
export type GmSrc = 'lua' | 'cpp' | 'engine' | 'custom' | 'console'

export interface GmParam {
  name: string
  type: string
  default?: string
  desc?: string
  enum?: string[]
  /** Lua：扫描脚本给的关联提示（Item.Id） */
  table?: string
}

export interface GmEntry {
  /** 全页唯一：lua:名字 / cpp:类.名字 / custom:id / console:命令 */
  key: string
  src: GmSrc
  name: string
  group: string
  desc: string
  params: GmParam[]
  /** C++：所在类（同名多处时执行要带）；server：要在服务器执行 */
  owner?: string
  library?: boolean
  server?: boolean
  /** Lua：定义的位置 */
  file?: string
  line?: number
  lua?: LuaGmItem
  /** 自定义 GM 的定义（gm.json 的 custom） */
  custom?: GmCustom
}

/** 分组名统一：「Cheat Manager」「CheatManager」「cheat_manager」算一组（截图里同一个类出现两次） */
export const groupKey = (g: string) => g.replace(/[\s_\-|]/g, '').toLowerCase()

/** 分组名拆层级：「角色 / 宝石」「角色/宝石」「角色\宝石」都算两层（左边的树按它分文件夹） */
export const groupPath = (label: string) =>
  label
    .split(/\s*[/\\]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)

/** 注释里的 @param 说明拆到参数上，说明本身只留前面那段 */
function splitDoc(tooltip: string) {
  const params: Record<string, string> = {}
  const text = tooltip.replace(/@param\s+(\w+)\s+([^@]*)/g, (_m, n: string, d: string) => {
    params[n] = d.trim()
    return ''
  })
  return { text: text.replace(/\s+/g, ' ').trim(), params }
}

export function fromCpp(items: CppGm[]): GmEntry[] {
  return items.map((i) => {
    const doc = splitDoc(i.tooltip ?? '')
    const owner = i.owner.replace(/^Default__/, '')
    return {
      key: `cpp:${i.owner}.${i.name}`,
      src: i.source !== 'library' && isEngine(i.owner) ? 'engine' : 'cpp',
      name: i.name,
      group: i.category || owner,
      desc: doc.text,
      params: i.params
        .filter((p) => !p.out)
        .map((p) => ({ name: p.name, type: p.type, enum: p.enum, desc: doc.params[p.name] })),
      owner: i.owner,
      library: i.source === 'library',
      server: i.server,
    }
  })
}

export function fromLua(items: LuaGmItem[]): GmEntry[] {
  return items.map((i) => ({
    key: `lua:${i.name}`,
    src: 'lua',
    name: i.name,
    group: i.group || (i.file.split('/').pop() ?? '').replace(/\.lua$/i, ''),
    desc: i.desc,
    params: i.params.map((p: LuaGmParam) => ({ ...p })),
    file: i.file,
    line: i.line,
    lua: i,
  }))
}

/** 搜索：名字、说明、参数名里含这段字（不分大小写，空格隔开的几个词都要含）；名字开头匹配的排前面 */
export function search(list: GmEntry[], q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  const hay = (e: GmEntry) => `${e.name} ${e.desc} ${e.group} ${e.params.map((p) => p.name).join(' ')}`.toLowerCase()
  const hits = list.filter((e) => words.every((w) => hay(e).includes(w)))
  const head = words[0]
  return [
    ...hits.filter((e) => e.name.toLowerCase().startsWith(head)),
    ...hits.filter((e) => !e.name.toLowerCase().startsWith(head)),
  ]
}

/** 自定义 GM 当成一条 GM 列出：参数是存的 args 的名字（执行时只有 editable 的能改） */
export function fromCustom(items: GmCustom[]): GmEntry[] {
  return items.map((c) => ({
    key: customKey(c.id),
    src: 'custom',
    name: c.name,
    group: '',
    desc: c.note ?? '',
    params: Object.keys(c.args).map((n) => ({ name: n, type: '' })),
    custom: c,
  }))
}

/** 控制台命令（引擎分类里：收藏的和最近用过的） */
export function fromConsole(cmds: { cmd: string; group: string }[]): GmEntry[] {
  return cmds.map(({ cmd, group }) => ({
    key: `console:${cmd}`,
    src: 'console',
    name: cmd,
    group,
    desc: '',
    params: [],
  }))
}

/** 参数实际用的表格关联：GM 设置里改过的优先，其次扫描脚本给的 <表>.<列> 提示 */
export function bindingOf(
  e: GmEntry,
  p: GmParam,
  cfg: LuaGmConfig | undefined,
): { binding?: LuaGmBinding; hint?: { table: string; key: string }; edited: boolean } {
  const k = `${e.name}.${p.name}`
  if (cfg && k in cfg.bindings) {
    const b = cfg.bindings[k]
    return b ? { binding: b, edited: true } : { edited: true }
  }
  const m = /^([^.]+(?:\.[^.]+)*?)\.([^.]+)$/.exec(p.table ?? '')
  return m ? { hint: { table: m[1], key: m[2] }, edited: false } : { edited: false }
}

/** C++ GM 在控制台里的写法（执行预览、宏步骤显示用） */
export const cppLine = (name: string, args: string[]) => [name, ...args.filter((a) => a !== '')].join(' ')
