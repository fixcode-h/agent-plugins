import type { LuaGmBinding } from './lua-gm/types.ts'
/**
 * UE 插件服务端和网页共用的数据形状（网页只 import type）。
 * 项目登记存在插件数据目录 projects/<面板项目 id>.json，不改面板核心的项目结构（设计文档 4.5）。
 */

/** Agent 对运行时的权限：只读 / 可写 / 写前问我 */
export type RuntimePerm = 'read' | 'write' | 'ask'
/** Agent 对资源的权限：只读 / 可改、保存前问我 / 直接保存 */
export type AssetPerm = 'read' | 'ask' | 'save'
/** Agent 对结构性操作（新建、复制、改名 / 移动、删除资源）的权限：不允许 / 每次问我 / 允许，不用问我 */
export type StructPerm = 'read' | 'ask' | 'allow'
/** Agent 在编辑器里执行 Python 的权限：不允许 / 允许，每次问我 / 允许，不用问我（老数据是布尔值，读时换算） */
export type PythonPerm = 'read' | 'ask' | 'allow'
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
  /** 默认全都放开不问（用户 2026-11-19 定），想收紧在 UE 页「权限与设置」里改 */
  perms: { runtime: RuntimePerm; asset: AssetPerm; struct: StructPerm; python: PythonPerm }
  /** GM 预设和宏存哪：项目里 .agent-panel/ue/gm.json（团队共用）/ 插件数据目录（只自己用） */
  gmStore: 'project' | 'local'
  /** 资源页收藏的文件夹存哪：项目文档根 docs/AgentPanel/UE（默认）/ 项目里 .agent-panel/ue，都在项目里、团队共用 */
  favStore: 'docs' | 'project'
  /** 手动指定的引擎目录（自动找不到时填） */
  engineDir: string
  /** 自定义编译命令（空用 Build.bat 默认的） */
  buildCmd: string
  /** 网页上选的目标：实例类型（editor / game / server / background）和世界 id */
  target: { kind: string; world: string }
  /** Lua 页「编译」的设置（server/lua-build/config.ts），没配过为空 */
  luaBuild?: LuaBuildConfig
  /**
   * 性能页录 trace 时带不带 Lua（server/perf/lua-trace.ts）：用户在录制控件上改过才有，没有时装了 UnLua 就带。
   * c=false 是 C 函数不单独成块（只录 lua 通道，时间算进调用它的 Lua 函数）
   */
  perfLua?: { on?: boolean; c?: boolean }
  addedAt: string
}

/** Lua 编译设置（设计稿四.3）：只能跑这里配好的两条指令 */
export interface LuaBuildConfig {
  /** 全编译的命令行（经 shell 执行） */
  full: string
  /** 增量编译的命令行：{files} 换成改过的文件（相对脚本目录、带引号），{filelist} 换成写了文件列表的临时文件 */
  incremental: string
  /** 工作目录，相对项目根；空是项目根 */
  cwd: string
  /** Lua 脚本根目录，相对项目根（UnLua 默认 Content/Script）：找改过的文件、文件名换模块名都按它 */
  scriptDir: string
  /** 报错格式：{file}:{line}: {message} 这样的模板，或前后带 / 的正则（命名分组 file、line、col、message） */
  errorFormat: string
  /** 编译成功后重载这次编过的模块 */
  autoReload: boolean
  /** 用哪个编辑器打开报错位置：{file}、{line} 占位，例如 code -g "{file}:{line}"；空用系统默认程序打开（不跳行） */
  editor: string
}

/** 编译里认出来的一条错误 */
export interface LuaBuildError {
  /** 相对项目根（项目外的文件保留绝对路径），/ 分隔 */
  file: string
  line: number
  col?: number
  message: string
  /** 磁盘上找到了这个文件（找不到的不能点开） */
  exists: boolean
}

/** 一次 Lua 编译（网页和 Agent 共用；输出逐行推给网页，事件 ue-lua-build） */
export interface LuaBuildRun {
  id: string
  mode: 'full' | 'incremental'
  status: 'running' | 'ok' | 'failed' | 'stopped'
  /** 实际执行的命令行 */
  command: string
  /** 增量编了哪些文件（相对脚本目录）；全编译是脚本目录下的 .lua 个数 */
  files: string[]
  fileCount: number
  startedAt: number
  endedAt?: number
  code?: number
  errors: LuaBuildError[]
  /** 完整输出写在这个文件里（Agent 只拿路径） */
  logFile: string
  /** 谁点的：网页上的你 / Agent */
  by: 'user' | 'agent'
  /** 编完自动重载的结果：重载了哪些模块，或者为什么没重载 */
  reload?: { ok: boolean; modules: string[]; message: string }
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
  /** 已装的桥接版本（Plugins/UELink/UELink.uplugin 的 VersionName，没有时看旧桥接 Plugins/AgentPanelBridge），没装为空 */
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
  /**
   * 进程活着、名片在，但 /info 几秒没回应（游戏线程卡在同步加载、编译着色器、断点里）：不是断开，等它忙完会自己回来。
   * since 是第一次没回应的时间（毫秒时间戳）；kind / detail / line 是从日志尾部认出的在忙什么，quietSec 是日志多久没动
   */
  busy?: { since: number; kind?: string; detail?: string; line?: string; quietSec?: number }
  /** 编辑器可用了没有（UELink 2.7 起）：false 表示连上了但还在启动（主窗口没出来、在扫资源）；旧 UELink 和非编辑器进程没有 */
  ready?: boolean
  error?: string
  log?: string
  worlds: World[]
  /** 装了 UnLua 的项目：桥接编进了 Lua 支持时有这个字段；available 表示现在拿得到 Lua 环境 */
  lua?: { available: boolean; error?: string; version?: string }
  /** 进程里加载了的 UELink 扩展（UEKit 的 AssetForge、GameTest），旧 UELink 没有这个字段 */
  extensions?: { name: string; version: string }[]
  /** 这个进程的桥接认得的操作（/info 的 ops）：网页按它决定显示不显示新功能（选中跟随、Lua 检视……），旧 UELink 没有 */
  ops?: string[]
  /** 能批量（paths / items）的操作（UELink 2.14 /info 的 batchOps），旧 UELink 没有 */
  batchOps?: string[]
  /**
   * 名片上的能力名（UELink 推送通道的 features）：不是操作、只是已有操作多了字段的（bp.layout）只能从这里看出来。
   * /info 不回这个字段，取名片上的；旧 UELink 的名片没有
   */
  features?: string[]
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
  /** 一步：C++ GM（gm）、Lua GM（lua，扫描出来的 GM 名，见 lua-gm/）或控制台命令（console） */
  steps: { gm?: string; lua?: string; console?: string; args?: string[] }[]
}
export interface GmStore {
  presets: GmPreset[]
  macros: GmMacro[]
  /** 收藏：控制台命令原文、GM 名 */
  favConsole: string[]
  favGm: string[]
  /** GM 参数绑定数据表：键是 <GM 名>.<参数名>，值是 DataTable 路径，下拉里列行名（设计文档 3.3） */
  bindings?: Record<string, string>
  /**
   * C++ GM 参数关联表格的列（和 Lua GM 同一种关联，经表格插件下拉搜）：键是 <GM 名>.<参数名>。
   * 同一个参数两种都有时用这个，旧的 DataTable 绑定只是还认
   */
  tableBindings?: Record<string, LuaGmBinding>
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
  /** 编译被开着的编辑器挡住（Live Coding）：网页按它给出处理方式，不只显示失败 */
  hint?:
    | { kind: 'live-coding'; blockers: BuildBlocker[] }
    /**
     * 这个引擎还有别的编译在跑（面板升级插件、刷新前起的，或者在命令行、VS 里起的），新的 Build.bat 会排队一直等它：
     * waiting=true 是这次已经开始、正排在它后面；否则这次没开始编（server/build/stale.ts）
     */
    | { kind: 'stale-build'; procs: BuildProc[]; waiting?: boolean }
  /** 用户在网页上取消的 */
  canceled?: boolean
  /** 分几步做的作业（UE 插件页「全部升级」）：每一步的插件名和状态，卡片按它显示升级中 / 排队中 */
  steps?: { name: string; status: 'wait' | 'run' | 'done' | 'failed' }[]
}

/** 这台机器上和这个引擎有关的编译进程（server/build/procs.ts）：Build.bat、UnrealBuildTool */
export interface BuildProc {
  pid: number
  /** 父进程 PID：从这里认出整棵进程树，结束时只结束树根 */
  ppid: number
  /** script：Build.bat / Build.sh；ubt：UnrealBuildTool */
  kind: 'script' | 'ubt'
  /** 命令行里的 .uproject 或 -Project=，看不出来为空 */
  project: string
  /** 编的就是这个项目 */
  same: boolean
  /** 面板这次运行里起的、还在跟踪的作业 id；没有就是残留（面板升级、重启前起的，或在外面起的） */
  job?: string
  /** 命令行（截短），给人认是哪一次编译 */
  cmd: string
}

/** 挡住编译的编辑器进程（server/procs.ts） */
export interface BuildBlocker {
  pid: number
  /** 命令行里的 .uproject，看不出来为空 */
  project: string
  /** 开的就是这个项目 */
  same: boolean
  /** -game 跑的游戏 */
  game: boolean
  /** 读不到路径和命令行（管理员权限打开的），看不出是不是这个引擎的 */
  unknown?: boolean
  /** 不是编辑器本身时的 exe 名（加载了 Live Coding 模块的进程、LiveCodingConsole） */
  name?: string
}

/** 一个项目的连接概况（项目切换、概览、对话右栏用） */
export interface ProjectState {
  project: UeProject
  instances: Instance[]
  /** 桥接插件装在项目里的版本，没装为空 */
  bridge: string
  /** 包里带的桥接版本（有新版本时提示升级） */
  bundled: string
  background: {
    running: boolean
    starting: boolean
    pid?: number
    error?: string
    /** 插件参数「编辑器没开时读资源」选了自动起后台编辑器（默认不自动起，用户 2026-11-16） */
    auto: boolean
  }
  jobs: Job[]
  /** 项目 Plugins/ 里有 UnLua（UE 没开时也列 Lua 页） */
  unlua?: boolean
  /** 项目里装了的 UEKit 扩展（磁盘上的版本） */
  extensions?: { name: string; version: string }[]
  /** 面板刚启动的编辑器的启动进度（server/launch/），没在启动时为空 */
  launch?: LaunchProgress
  /** VS 调试（UEToVS 0.8.0 的调试控制管道，server/vs-debug/）：UE 页「VS 调试」卡片和 Agent 的 ue_vs_* 工具用同一份 */
  vsDebug?: VsDebugState
}

/**
 * VS 调试状态。协议见 UEToVS 仓库 docs/design/VS-调试控制.md；status 是管道 status 操作的原样结果。
 * available=false 时 reason 说明为什么（没开 VS / UEToVS 太旧 / 设置里关了调试控制…），message 是给人看的一句话
 */
export interface VsDebugState {
  available: boolean
  reason?: 'no-vs' | 'no-control' | 'connect-failed' | 'protocol' | 'error'
  message?: string
  /** VS 没开着这个项目时，开着别的项目、能在里面打开这个项目的 VS（UEToVS 0.9.5 起） */
  others?: VsOtherInstance[]
  /** 找到的 .sln（VS 没开时「打开 VS」按钮用） */
  solution?: string
  /** 本机装的 VS（vswhere 找到 devenv 时有） */
  devenv?: string
  status?: VsDebugStatus
  /** 断点（bp.list 前 50 个） */
  breakpoints?: VsBreakpoint[]
}

export interface VsOtherInstance {
  pid: number
  /** 它现在开着的解决方案 */
  solution: string
  project?: string
}

export interface VsDebugFrame {
  i?: number
  function: string
  file?: string
  line?: number
  module?: string
}

export interface VsDebugStatus {
  mode: 'design' | 'run' | 'break'
  building: boolean
  launchPending?: boolean
  lastBuildFailed?: boolean
  lastReason?: string
  startupProject?: string
  configuration?: string
  processes?: { pid: number; name: string }[]
  breakpoints?: number
  breakCount?: number
  thread?: { id: number; name: string }
  location?: VsDebugFrame
  breakpoint?: string
  stack?: VsDebugFrame[]
}

export interface VsBreakpoint {
  i: number
  file?: string
  line?: number
  function?: string
  enabled: boolean
  condition?: string
  hitCount?: number
  hits?: number
  message?: string
  byAgent?: boolean
  bound?: number
}

/**
 * 编辑器启动进度：stage 是日志里认出的阶段（server/launch/stages.ts 的 id），percent 是估算的
 * （UE 不往日志写百分比，按阶段和上次启动用时推），shadersLeft 是日志里读到的实数
 */
export interface LaunchProgress {
  pid: number
  startedAt: number
  /** 预计总用时：这个项目上次启动连上用了多久，没有记录时 90 秒 */
  expectedMs: number
  stage: string
  percent: number
  shadersLeft?: number
  shadersMax?: number
  /** rebuild：UE 弹窗问要不要重新编译模块，等人点；link：引擎起来了但 UELink 一直没连上；vs：经 VS 启动时 VS 一时没回应（多半弹着对话框） */
  waiting?: 'rebuild' | 'link' | 'vs'
  /** vs：VS 开着这个项目，经 VS 按 F5 启动（挂着调试器，launch/via-vs.ts）；直接启动时没有 */
  via?: 'vs'
  status: 'running' | 'ready' | 'failed'
  error?: string
}
