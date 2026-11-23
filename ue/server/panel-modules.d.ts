// 面板开放给插件的模块（sdk/host-modules.json），构建时由 scripts/build.mjs 接到面板那一份。
// ue 插件不照面板源码布局放文件、不从 .panel 取类型，这里只声明用到的那几个函数
declare module '@panel/server/download' {
  export function downloadFile(
    url: string,
    to: string,
    o?: { signal?: AbortSignal; headers?: Record<string, string>; connections?: number; idleMs?: number },
  ): Promise<void>
}

// 网页：面板的接口请求（带访问令牌、出错抛出接口给的原因）。GM 参数下拉经面板动作入口 /actions/table.* 读表格插件的数据
declare module '@panel/web/src/lib/api' {
  export function request<T>(url: string, init?: RequestInit): Promise<T>
}

/** 面板的拼音首字母（GM 页左栏分组按 jszl 这类首字母搜） */
declare module '@panel/shared/pinyin' {
  export function pinyinInitials(s: string): string
}

/**
 * 网页：在项目里开一个 AI 分析对话跑一段提示词（插件接口 6 开放）。GameTest「AI 整理」用：
 * 每一轮说完把最后一条回复交给 resolve，返回 error 时让对话自己修正一次
 */
declare module '@panel/web/src/lib/assist-conv' {
  export function runPromptInProject(opts: {
    projectId: string
    title: string
    prompt: () => Promise<string>
    analysis?: 'init' | 'run' | string
    resolve: (reply: string) => Promise<{ error?: string }>
  }): void
}

/**
 * 网页：面板的通用流程图画布（点状底、缩放、右下小地图、底部工具条，面板 web/src/components/flow/GraphCanvas.tsx）。
 * GameTest 流程图用它，外观和工作流编辑器一致；节点用同样开放的 @xyflow/react 写（和面板共用一份实例）
 */
declare module '@panel/web/src/components/flow/GraphCanvas' {
  import type { ComponentType, HTMLAttributes, ReactElement, ReactNode } from 'react'
  import type { Edge, Node, ReactFlowProps } from '@xyflow/react'
  export type GraphCanvasProps<N extends Node = Node, E extends Edge = Edge> = ReactFlowProps<N, E> & {
    editable?: boolean
    panMode?: boolean
    minimap?: number | false
    miniColor?: (n: N) => string
    autoFit?: boolean
    frameClassName?: string
    children?: ReactNode
  }
  export function GraphCanvas<N extends Node = Node, E extends Edge = Edge>(p: GraphCanvasProps<N, E>): ReactElement
  export function CanvasToolbar(p: HTMLAttributes<HTMLDivElement>): ReactElement
  export const CanvasToolbarSep: ComponentType
}

/** 网页：圆底数字角标（没发生不画，超过 999 写「999+」，面板 web/src/components/ui/count-badge.tsx） */
declare module '@panel/web/src/components/ui/count-badge' {
  import type { HTMLAttributes, ReactElement } from 'react'
  export const COUNT_BADGE_MAX: number
  export function countBadgeText(n: number, max?: number): string
  export function CountBadge(
    p: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & { count: number; max?: number; corner?: boolean },
  ): ReactElement | null
}

/** 网页：开关（面板 web/src/components/ui/switch.tsx，Radix Switch），检查器的开关行用 */
declare module '@panel/web/src/components/ui/switch' {
  import type { ReactElement } from 'react'
  export function Switch(p: {
    checked?: boolean
    defaultChecked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    className?: string
    'aria-label'?: string
  }): ReactElement
}

/** 服务端：文件的版本记录和取某一版的字节（面板 server/exec/vcs-history.ts，表格插件也用）；资源页「版本差异」用 */
declare module '@panel/server/exec/vcs-history' {
  export interface FileRev {
    id: string
    label: string
    author: string
    time: string
    message: string
  }
  export interface FileHistory {
    vcs: 'git' | 'p4' | 'svn' | 'none'
    base: string
    revs: FileRev[]
    error?: string
  }
  export class VcsInputError extends Error {}
  export const MOVING_REV: RegExp
  export function fileHistory(dir: string, rel: string, max?: number): Promise<FileHistory>
  export function fileAt(dir: string, rel: string, rev: string): Promise<Buffer | null>
}

/** 网页：版本差异弹窗的外壳（左边版本列表可拖宽，面板 web/src/components/ui/version-diff.tsx，表格插件也用） */
declare module '@panel/web/src/components/ui/version-diff' {
  import type { ReactElement, ReactNode } from 'react'
  export interface VersionRev {
    id: string
    label: string
    author?: string
    time?: string
    message?: string
  }
  export interface VersionList {
    vcs: 'git' | 'p4' | 'svn' | 'none'
    revs: VersionRev[]
    error?: string
  }
  export type VersionPick = 'local' | number
  export function VersionDiffShell(props: {
    open: boolean
    onClose: () => void
    meta: ReactNode
    list: VersionList | null
    failed?: string
    pick: VersionPick
    onPick: (p: VersionPick) => void
    local?: { meta: string; message: string }
    tags?: Record<string, ReactNode>
    header: ReactNode
    children: ReactNode
    paneKey: string
    className?: string
  }): ReactElement
}

/** 网页：面板统一的 diff 画法（照 Claude Code，面板 web/src/components/ui/UnifiedDiff.tsx） */
declare module '@panel/web/src/components/ui/UnifiedDiff' {
  import type { ReactElement } from 'react'
  export function UnifiedDiff(props: {
    diff?: string
    rows?: { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'note'; text: string; n?: number }[]
    file?: string
    wrap?: boolean
    max?: number
    className?: string
    label?: string
  }): ReactElement
}

/** 面板唯一的 git 入口（按行收输出，退出码不为 0 也不抛） */
declare module '@panel/server/exec/git' {
  export function gitRun(
    cwd: string,
    args: string[],
    o?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: string }>
}

/** 版本管理服务（面板 ADR 0073）：p4 / svn 的唯一运行入口（设 PWD、限流、计数） */
declare module '@panel/server/vcs/run' {
  export interface VcsResult {
    ok: boolean
    code: number | null
    stdout: Buffer
    stderr: string
    spawnError?: string
    timedOut?: boolean
    tooLarge?: boolean
  }
  export function vcsExec(
    cmd: 'p4' | 'svn',
    args: string[],
    cwd: string,
    o?: { stdin?: string; timeoutMs?: number; maxBytes?: number },
  ): Promise<VcsResult>
  export function vcsWhy(cmd: 'p4' | 'svn', args: string[], r: VcsResult): string
}

/** 版本管理服务：一个目录归哪种版本管理（面板和插件只用这一套判断） */
declare module '@panel/server/vcs/detect' {
  export function detectVcs(dir: string): Promise<{ vcs: 'git' | 'p4' | 'svn' | 'none'; root: string }>
}

/** 版本管理服务：P4 改文件前后的签出规则（Agent 改文件的钩子、UE 保存、表格保存共用） */
declare module '@panel/server/vcs/p4-plan' {
  export type P4Run = (args: string[], stdin?: string) => Promise<{ ok: boolean; out: string; err: string }>
  export interface P4Stale {
    file: string
    have: number
    head: number
  }
  export interface P4WritePlan {
    edit: string[]
    add: string[]
    opened: string[]
    stale: P4Stale[]
    error?: string
  }
  export function p4WritePlan(run: P4Run, files: string[], exists?: (f: string) => boolean): Promise<P4WritePlan>
  export function p4Open(run: P4Run, verb: 'edit' | 'add', files: string[]): Promise<string | undefined>
}

/** 在目录里跑 p4（走版本管理服务的统一入口） */
declare module '@panel/server/p4-split' {
  export function p4Runner(cwd: string): import('@panel/server/vcs/p4-plan').P4Run
}

/** 文件监听：盯几个文件的内容改动（共用目录监听、停手 300 毫秒、比修改时间，面板 ADR 0074） */
declare module '@panel/server/watch/files' {
  export interface FileStamp {
    file: string
    mtime: string
  }
  export function watchFiles(
    files: string[],
    onChange: (changed: FileStamp[]) => void,
    o?: { settleMs?: number; known?: Record<string, string> },
  ): { close(): void; unwatched: string[] }
}

/** 文件监听：盯整棵目录树（Windows / macOS 递归句柄，Linux 逐目录） */
declare module '@panel/server/watch/tree' {
  export const TREE_SKIP: Set<string>
  export function watchTree(
    root: string,
    on: (rel: string | null) => void,
    o?: { skipDir?: (name: string) => boolean; onLost?: (why: string) => void; maxDirs?: number },
  ): { close(): void } | undefined
}

/** 派生缓存：同一个键只算一遍、失败不记、过期或依赖的文件变了才重算，设置里能看到和清空 */
declare module '@panel/server/memo/index' {
  export interface MemoWatch {
    trees?: string[]
    exts?: string[]
    files?: string[]
  }
  export interface Memo<K, V> {
    get(key: K, o?: { fresh?: boolean }): Promise<V>
    peek(key: K): Promise<V> | undefined
    invalidate(key?: K): void
    size(): number
  }
  export function createMemo<K, V>(o: {
    name: string
    load: (key: K) => Promise<V>
    keyOf?: (key: K) => string
    ttlMs?: number
    max?: number
    watch?: (key: K) => MemoWatch | undefined
  }): Memo<K, V>
}

/** 文件监听：订阅一个目录的改动（所有订阅者共用一个系统监听） */
declare module '@panel/server/watch/dir' {
  export function watchDir(
    dir: string,
    on: (name: string | null) => void,
    o?: { recursive?: boolean; onLost?: (why: string) => void },
  ): { close(): void } | undefined
}

/** 项目文件索引的帮助函数：等就绪、按目录取（带 ext）、换相对路径（UE、表格插件共用） */
declare module '@panel/server/file-index/indexed' {
  type Files = import('../../sdk/server.ts').PluginFiles | undefined
  type Index = import('../../sdk/server.ts').PluginFileIndex
  export function readyIndex(files: Files, projectIdOrDir: string, ms?: number): Promise<Index | undefined>
  export function indexedTree(
    files: Files,
    root: string,
    o?: { ext?: string[]; want?: RegExp; idx?: Index },
  ): Promise<string[] | undefined>
  export function indexedDirs(files: Files, root: string, idx?: Index): Promise<string[] | undefined>
  export function touchIndexed(files: Files, paths: string[]): void
  export function extsOfGlob(glob: string): string[] | undefined
}

/** 后台作业注册表：侧栏底部一处看全、看日志、取消（面板 ADR 0075） */
declare module '@panel/server/jobs/registry' {
  export interface JobHandle {
    id: string
    log(text: string): void
    progress(p: { phase?: string; done?: number; total?: number }): void
    end(ok: boolean, info?: string): void
    readonly canceled: boolean
  }
  export function startJob(o: {
    source: string
    projectId?: string
    kind: string
    title: string
    cancel?: () => void | Promise<void>
  }): JobHandle
}

/** 服务端：外部进程统一入口（面板 server/exec/tracked.ts，ADR 0076）：起的进程进孤儿登记，面板被强杀后下次启动清掉 */
declare module '@panel/server/exec/tracked' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process'
  export type TrackedSpawnOptions = Pick<
    SpawnOptions,
    'cwd' | 'env' | 'shell' | 'detached' | 'stdio' | 'windowsHide'
  > & {
    cwd: string
    source: string
    title: string
    tag?: string
  }
  export function spawnTracked(command: string, args: string[], o: TrackedSpawnOptions): ChildProcess
  export function stopTree(pid: number, o?: { waitMs?: number }): Promise<{ ok: boolean; error?: string }>
}

/** 网页：按项目列表打开的菜单（右键、下拉、子菜单、菜单内搜索；面板 web/src/components/ui/item-menu.tsx，面板整个应用挂了一个 MenuHost） */
declare module '@panel/web/src/components/ui/item-menu' {
  import type { LucideIcon } from 'lucide-react'
  import type { MouseEvent, ReactElement, ReactNode } from 'react'
  export interface MenuAction {
    label: string
    icon?: LucideIcon
    onClick: () => void
    disabled?: boolean
    danger?: boolean
    hint?: string
    checked?: boolean
    lead?: ReactNode
    dim?: boolean
  }
  export type MenuLeaf = MenuAction | { title: string } | 'sep'
  export interface MenuSub {
    label: string
    icon?: LucideIcon
    hint?: string
    disabled?: boolean
    sub: (MenuLeaf | false | '' | undefined | null)[]
    search?: string
  }
  export type MenuItem = MenuLeaf | MenuSub
  export interface MenuOptions {
    search?: string
    onClose?: () => void
  }
  type Items = (MenuItem | false | '' | undefined | null)[]
  export function openMenu(e: MouseEvent | globalThis.MouseEvent, items: Items, o?: MenuOptions): void
  export function openMenuAt(el: HTMLElement, items: Items, o?: MenuOptions): void
  export function closeMenu(): void
  export function copyText(text: string): void
  export function pageMenu(e: MouseEvent | globalThis.MouseEvent): void
  export function MenuHost(): ReactElement | null
}

/** 网页：名字旁的圆底问号，悬停 / 聚焦弹说明（面板 web/src/components/ui/help-tip.tsx） */
declare module '@panel/web/src/components/ui/help-tip' {
  import type { ReactElement, ReactNode } from 'react'
  export function HelpTip(p: { children: ReactNode; className?: string }): ReactElement
}

/** 网页：搜索框：边打字边筛或点「搜索」，带清空（面板 web/src/components/ui/search-box.tsx） */
declare module '@panel/web/src/components/ui/search-box' {
  import type { ReactElement, ReactNode } from 'react'
  export function SearchBox({
    initial,
    placeholder,
    hint,
    onSearch,
    busy,
    allowEmpty,
    live,
    addon,
    onEnter,
    onFocusChange,
  }: {
    initial?: string
    placeholder: string
    hint?: string
    onSearch: (q: string) => void
    busy?: boolean
    allowEmpty?: boolean
    live?: boolean
    addon?: ReactNode
    onEnter?: (q: string) => void
    onFocusChange?: (focused: boolean) => void
  }): ReactElement
}

/** 网页：树和折叠行前的小三角（面板 web/src/components/ui/tree/caret.tsx） */
declare module '@panel/web/src/components/ui/tree/caret' {
  import type { ReactElement } from 'react'
  export function Caret({ open, className }: { open: boolean; className?: string }): ReactElement
}

/** 网页：只画可见行的树列表（面板 web/src/components/ui/tree/tree-list.tsx） */
declare module '@panel/web/src/components/ui/tree/tree-list' {
  import type { LucideIcon } from 'lucide-react'
  import type { MouseEvent, ReactElement, ReactNode } from 'react'
  export interface TreeLine {
    key: string
    depth: number
    label: ReactNode
    icon: LucideIcon
    iconTone?: string
    expandable: boolean
    open: boolean
    selected: boolean
    from?: boolean
    title?: string
    aside?: ReactNode
    onToggle?: () => void
    onSelect?: () => void
    clickToggles?: boolean
    onDouble?: () => void
    onMenu?: (e: MouseEvent) => void
    onHover?: () => void
    action?: ReactNode
    actionShown?: boolean
  }
  export function TreeList({
    lines,
    label,
    reveal,
  }: {
    lines: TreeLine[]
    label: string
    reveal?: {
      key: string
      seq: number
    }
  }): ReactElement
}

/** 网页：树上面的搜索框、命中数和保留命中及上级（面板 web/src/components/ui/tree/tree-search.tsx） */
declare module '@panel/web/src/components/ui/tree/tree-search' {
  import type { ReactElement, ReactNode } from 'react'
  export function hitText(q: string, ...fields: (string | undefined)[]): boolean
  export function keepSet<N>(
    roots: N[],
    kidsOf: (n: N) => N[],
    keyOf: (n: N) => string,
    test: (n: N) => boolean,
  ): {
    keep: Set<string>
    hits: number
  }
  export function Hit({ text, q }: { text: string; q: string }): ReactElement
  export function TreeSearch({
    value,
    onChange,
    placeholder,
    hits,
    partial,
    busy,
    extra,
    addon,
    onEnter,
    onFocusChange,
  }: {
    value: string
    onChange: (q: string) => void
    placeholder: string
    hits?: number
    partial?: boolean
    busy?: boolean
    extra?: ReactNode
    addon?: ReactNode
    onEnter?: (q: string) => void
    onFocusChange?: (focused: boolean) => void
  }): ReactElement
  export function TreeSearchSpecimen(): ReactElement
}

/** 网页：切换内容时的半透明遮罩和延时转圈（面板 web/src/components/ui/loading-mask.tsx） */
declare module '@panel/web/src/components/ui/loading-mask' {
  import type { ReactElement, ReactNode } from 'react'
  export function LoadingMask({
    show,
    label,
    children,
  }: {
    show: boolean
    label?: ReactNode
    children: ReactNode
  }): ReactElement
  export function LoadingMaskSpecimen(): ReactElement
}

/** 网页：按 CSS 变量分的多栏（百分比默认、窄屏上下排、拖边记住尺寸；面板 web/src/components/ui/split-pane.tsx） */
declare module '@panel/web/src/components/ui/split-pane' {
  import type { CSSProperties, ReactElement } from 'react'
  export function storedPane(key: string): number
  export function forgetPane(key: string): void
  export interface Pane {
    size: string
    min: number
    axis: 'x' | 'y'
    dragging: boolean
    setDragging: (v: boolean) => void
    set: (n: number) => void
    save: (n: number | undefined) => void
    reset: () => void
    style: (max: string) => CSSProperties
  }
  export function usePane(key: string, def: string, min: number, axis?: 'x' | 'y'): Pane
  export function usePaneHeight(key: string, def: string, min: number): Pane
  export const SPLIT_ROW: string
  export const STACK: string
  export const PANE_FIXED: string
  export const PANE_FILL: string
  export const PANE_FIXED_H: string
  export const PANE_FILL_H: string
  export function SplitHandle(p: {
    pane: Pane
    paneRef: { current: HTMLElement | null }
    side?: 'left' | 'right'
    reserve: () => number
    edge?: boolean
  }): ReactElement
}

/** 服务端：项目文档根变了（项目设置里改的）时通知（面板 server/docs/root-cache.ts）；root 为空表示可能变了、自己重新问 */
declare module '@panel/server/docs/root-cache' {
  export function onDocRootChange(fn: (projectId: string, root: string | undefined) => void): () => void
}

/** 服务端：按项目存数据（面板 server/project-data/index.ts）：共享的在文档根/AgentPanel/<名字>，本机的在数据目录，写入原子且按 P4 签出规则 */
declare module '@panel/server/project-data/index' {
  export interface ProjectData {
    shared: string
    local: string
    write: (file: string, data: string | object) => Promise<void>
  }
  export function projectData(projectId: string, name: string): Promise<ProjectData>
  export function writeTracked(file: string, text: string): Promise<void>
}

declare module '@panel/shared/text-match/index' {
  /** subject 是不是匹配通配 pattern（* 任意串、? 一个字符，不分大小写） */
  export function wildcard(subject: string, pattern: string): boolean
  export function wildcardRe(pattern: string): RegExp
  export interface GlobOptions {
    ignoreCase?: boolean
    dirPrefix?: boolean
  }
  export function globRe(glob: string, o?: GlobOptions): RegExp
  export function globMatch(glob: string, file: string, o?: GlobOptions): boolean
  export function normPath(p: string): string
  export function splitPatterns(s: string): string[]
  export function queryWords(q: string): string[]
  export function textHit(fields: string | (string | undefined | null)[], query: string): boolean
  export function textScore(text: string, query: string): number
}

declare module '@panel/server/net' {
  /** 和 fetch 一样用，走面板的代理设置和 GitHub 下载来源；timeoutMs 只限制等到响应头的时间 */
  export function netFetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>
}

declare module '@panel/shared/mirrors/registry' {
  export type MirrorId = 'npm' | 'huggingface' | 'pypi' | 'ffmpeg-static'
  /** 候选地址：用镜像时镜像在前、官方兜底，不用时只给官方 */
  export function mirrorUrls(id: MirrorId, path: string, useMirror: boolean): string[]
  export function mirrorUrl(id: MirrorId, path: string, useMirror: boolean): string
  export function toMirror(id: MirrorId, url: string, useMirror: boolean): string
}
