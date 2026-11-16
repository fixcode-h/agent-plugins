import type { LuaGmBinding, LuaGmConfig, LuaGmItem, LuaGmParam } from '../../../server/lua-gm/types.ts'

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

export type GmSrc = 'lua' | 'cpp' | 'engine'

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
  /** 全页唯一：lua:名字 / cpp:类.名字 */
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
}

/**
 * 引擎自带的类：这些类（和它们的 Default__ 对象）上的 Exec 函数是引擎的调试命令，几十个，
 * 和项目自己的 GM 混在一起找不到（用户 2026-11-16 截图）。项目自己的子类（XXPlayerController）不在这里，算项目的
 */
const ENGINE = new Set(
  [
    'CheatManager',
    'CheatManagerExtension',
    'PlayerController',
    'HUD',
    'DebugCameraController',
    'DebugCameraHUD',
    'GameModeBase',
    'GameMode',
    'GameStateBase',
    'PlayerState',
    'Pawn',
    'Character',
    'DefaultPawn',
    'SpectatorPawn',
    'GameViewportClient',
    'LocalPlayer',
    'Engine',
    'GameEngine',
    'EditorEngine',
    'UnrealEdEngine',
    'AIController',
    'GameplayDebuggerCategoryReplicator',
    'GameplayDebuggerPlayerManager',
    'LogVisualizer',
    'AbilitySystemComponent',
    'AbilitySystemCheatManagerExtension',
    'GameplayCueManager',
    'EnhancedInputLocalPlayerSubsystem',
    'WorldPartitionSubsystem',
    'NavigationSystemV1',
  ].map((x) => x.toLowerCase()),
)
const isEngine = (owner: string) =>
  ENGINE.has(
    owner
      .replace(/^Default__/, '')
      .replace(/_C$/, '')
      .toLowerCase(),
  )

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

/**
 * 收藏的写法（存在 gm.json 的 favGm 里，和以前兼容）：C++ 是「名字 参数…」，Lua 前面加 lua:。
 * 同一条 GM 可以收藏几组不同的参数
 */
export const favOf = (e: GmEntry, args: string[]) =>
  [e.src === 'lua' ? `lua:${e.name}` : e.name, ...args.map((a) => a.replace(/\s+/g, '_'))].join(' ').trim()
export function parseFav(f: string) {
  const [head, ...args] = f.split(' ')
  return head.startsWith('lua:')
    ? { key: `lua:${head.slice(4)}`, name: head.slice(4), lua: true, args }
    : { name: head, lua: false, args }
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
