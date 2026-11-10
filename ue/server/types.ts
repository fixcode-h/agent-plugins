/**
 * UE 插件服务端和网页共用的数据形状（网页只 import type）。
 * 项目登记存在插件数据目录 projects/<面板项目 id>.json，不改面板核心的项目结构（设计文档 4.5）。
 */

/** Agent 对运行时的权限：只读 / 可写 / 写前问我 */
export type RuntimePerm = 'read' | 'write' | 'ask'
/** Agent 对资源的权限：只读 / 可改、保存前问我 / 直接保存 */
export type AssetPerm = 'read' | 'ask' | 'save'
export type Vcs = 'git' | 'p4' | 'svn' | 'none'
/** 桥接插件装进项目的方式：只在本机（写进 ignore）/ 加入版本管理 */
export type InstallMode = 'local' | 'vcs'

export interface EngineInfo {
  /** .uproject 里的 EngineAssociation（5.4、{GUID}、空） */
  association: string
  /** 引擎根目录（含 Engine/），找不到为空 */
  dir: string
  /** 5.4.4 这类；找不到引擎时按 association 推的 5.4 */
  version: string
  /** 来源：launcher、source、custom、unknown */
  source: string
}

export interface UeProject {
  /** 面板项目 id */
  id: string
  name: string
  /** 项目根目录（.uproject 所在） */
  root: string
  uproject: string
  /** .uproject 的文件名（不带扩展名），也是日志文件名、编辑器目标名的前缀 */
  uname: string
  engine: EngineInfo
  /** 有 Source/ 的 C++ 项目；纯蓝图项目编译桥接需要本机装 VS */
  cpp: boolean
  vcs: Vcs
  install?: { mode: InstallMode; version: string; at: string }
  perms: { runtime: RuntimePerm; asset: AssetPerm }
  /** GM 预设和宏存哪：项目里 .agent-panel/ue/gm.json（团队共用）/ 插件数据目录（只自己用） */
  gmStore: 'project' | 'local'
  /** 手动指定的引擎目录（自动找不到时填） */
  engineDir: string
  /** 自定义编译命令（空用 Build.bat 默认的） */
  buildCmd: string
  /** 网页上选的目标：实例类型（editor / game / server / background）和世界 id */
  target: { kind: string; world: string }
  addedAt: string
}

/** 项目检测的结果（添加项目弹窗第二步） */
export interface Detection {
  ok: boolean
  error?: string
  root: string
  uproject: string
  uname: string
  engine: EngineInfo
  /** 引擎版本够不够 5.4 */
  supported: boolean
  cpp: boolean
  vcs: Vcs
  /** 已装的桥接版本（Plugins/AgentPanelBridge/*.uplugin 的 VersionName），没装为空 */
  bridge: string
  running: { pid: number; kind: string }[]
}

export interface World {
  id: string
  type: string
  netMode: string
  pieInstance?: number
  map: string
  player?: string
}

/** 一个运行中的 UE 进程（名片 + /info） */
export interface Instance {
  pid: number
  port: number
  kind: string
  engine: string
  bridge: string
  startedAt: string
  /** /info 连得上 */
  online: boolean
  error?: string
  log?: string
  worlds: World[]
}

export interface Target {
  /** pid，或实例类型 editor / game / server / background */
  instance?: number | string
  world?: string
}

/** 谁做的：你（网页）或某个对话 */
export type Actor = { kind: 'user' } | { kind: 'agent'; taskId: string; agent?: string }

/** 操作记录的一条 */
export interface HistoryItem {
  id: string
  at: string
  actor: Actor
  pid?: number
  instanceKind?: string
  world?: string
  op: string
  /** 一句话：改了什么 */
  summary: string
  prev?: unknown
  value?: unknown
  ok: boolean
  error?: string
  /** 能撤回时：撤回要执行的操作 */
  undo?: { op: string; args: Record<string, unknown> }
  /** 不能撤回的原因（清日志、调函数…） */
  noUndo?: string
  undone?: string
}

export interface GmPreset {
  id: string
  name: string
  /** GM 名（gm.list 里的 name）或控制台命令 */
  gm?: string
  console?: string
  args?: string[]
}
export interface GmMacro {
  id: string
  name: string
  steps: { gm?: string; console?: string; args?: string[] }[]
}
export interface GmStore {
  presets: GmPreset[]
  macros: GmMacro[]
  /** 收藏：控制台命令原文、GM 名 */
  favConsole: string[]
  favGm: string[]
  /** GM 参数绑定数据表：键是 <GM 名>.<参数名>，值是 DataTable 路径，下拉里列行名（设计文档 3.3） */
  bindings?: Record<string, string>
}

export interface Job {
  id: string
  kind: 'build' | 'install' | 'uninstall' | 'background' | 'editor'
  title: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  startedAt: string
  endedAt?: string
  code?: number
}

/** 一个项目的连接概况（项目切换、概览、对话右栏用） */
export interface ProjectState {
  project: UeProject
  instances: Instance[]
  /** 桥接插件装在项目里的版本，没装为空 */
  bridge: string
  /** 包里带的桥接版本（有新版本时提示升级） */
  bundled: string
  background: { running: boolean; starting: boolean; pid?: number; error?: string }
  jobs: Job[]
}
