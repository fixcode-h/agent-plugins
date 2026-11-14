/**
 * 表格页的接口（server/tables/*）：列表、打开、内容搜索、结构文件；保存、版本、对比、AI 分析也从这里调。
 */
import type { TableDoc, TableRoot, TableSchema, TableSearch, TablesConfig, TablesIndex } from '@shared/tables'
import type { SheetEdit, TableSave } from '@shared/table-edit'
import type { TableCreate } from '@shared/table-create'
import type { SheetProblems } from '@shared/table-struct'
import type { SheetData } from '@shared/files'
import type { ExportEvent } from '@shared/table-export'
import type { EnumRename } from '@shared/table-enum-rename'
import type { ReplaceResult, TableReplaceBody, TableSearchOpts } from '@shared/table-search'
import type { CellAt, CellChange } from '@shared/table-blame'
import type { EnumScan, ScanRun, ScanState } from '@shared/table-enum-scan'
import { failure, json, request } from './api'
import { trackedFetch } from './connection'

const q = encodeURIComponent

const searchQuery = (o: TableSearchOpts) =>
  `q=${q(o.q)}${o.caseSensitive ? '&case=1' : ''}${o.whole ? '&whole=1' : ''}${o.regex ? '&regex=1' : ''}`

/** 表格插件的接口挂在面板给插件的 /api/plugins/tables/api/ 下（服务端 server/index.ts 把表格页那组接口挂在 /tables） */
const BASE = '/plugins/tables/api/tables'

export const tablesApi = {
  /** fresh：重走目录（刷新按钮），不用服务端几秒内的缓存 */
  list: (projectId: string, fresh = false) => request<TablesIndex>(`${BASE}/${projectId}${fresh ? '?fresh=1' : ''}`),
  /** 按还没保存的配置找一遍（项目设置里逐个目录显示找到几个） */
  probe: (projectId: string, path: string, tables: TablesConfig) =>
    request<TablesProbe>(`${BASE}/${projectId}/probe`, json('POST', { path, tables })),
  open: (projectId: string, path: string) => request<TableDoc>(`${BASE}/${projectId}/file?path=${q(path)}`),
  /** 每张表不能在中间插删行列的原因（xlsx 有公式、合并单元格这些；空数组 = 可以）和用到的最后一列；CSV 返回 {} */
  shiftCheck: (projectId: string, path: string) =>
    request<Record<string, { why: string[]; last: number }>>(`${BASE}/${projectId}/shift-check?path=${q(path)}`),
  /** 登记这个页面（推送连接 conn）在这个项目里打开着的文件：外面改了服务端推 file-changed 过来 */
  watch: (projectId: string, conn: string, files: { path: string; mtime: string }[]) =>
    request<{ watching: number }>(`${BASE}/${projectId}/watch`, json('POST', { conn, files })),
  /** 文件现在的修改时间（外部改动检测：忙完后再对一次） */
  stat: (projectId: string, path: string) =>
    request<{ mtime?: string; size?: number; missing?: boolean }>(`${BASE}/${projectId}/stat?path=${q(path)}`),
  /** 面板文件弹窗里的表格文件归不归表格页：rel 是表格页用的路径；same 为 false 是独立分支里的副本 */
  claim: (projectId: string, path: string, root: string) =>
    request<{ rel: string | null; same: boolean }>(`${BASE}/${projectId}/claim?path=${q(path)}&root=${q(root)}`),
  /** 跨表搜索：「字段名:值」只在那一列找；三个开关和表格里的查找替换一样 */
  search: (projectId: string, o: TableSearchOpts, signal?: AbortSignal) =>
    request<TableSearch>(`${BASE}/${projectId}/search?${searchQuery(o)}`, { signal }),
  /** 跨表批量替换：apply=false 只预览；apply=true 只写 files 里勾选的文件（带预览时的修改时间） */
  replace: (projectId: string, body: TableReplaceBody, signal?: AbortSignal) =>
    request<ReplaceResult>(`${BASE}/${projectId}/replace`, { ...json('POST', body), signal }),
  schema: (projectId: string) => request<TableSchema>(`${BASE}/${projectId}/schema`),
  /** 枚举扫描：ids 手动扫这几条；auto 自动刷新（只扫源文件变了的，file 时只看用到它的规则）。返回扫了的几条 */
  enumScan: (projectId: string, pick: { ids?: string[]; auto?: boolean; file?: string }) =>
    request<{ runs: ScanRun[] }>(`${BASE}/${projectId}/enum-scan`, json('POST', pick)),
  /** 每条规则上次扫的情况 */
  enumScanState: (projectId: string) => request<Record<string, ScanState>>(`${BASE}/${projectId}/enum-scan`),
  /** 试跑一条规则（可能还没保存）：只读，不写结果 */
  enumScanTry: (projectId: string, scan: EnumScan) =>
    request<ScanRun>(`${BASE}/${projectId}/enum-scan/try`, json('POST', scan)),
  saveSchema: (projectId: string, s: TableSchema) =>
    request<TableSchema>(`${BASE}/${projectId}/schema`, json('PUT', s)),
  /** 保存改动：返回保存后的文件 */
  save: (projectId: string, body: TableSave) => request<TableDoc>(`${BASE}/${projectId}/save`, json('POST', body)),
  /** 新建表格：返回新文件在表格页里的路径 */
  create: (projectId: string, body: TableCreate) =>
    request<{ path: string }>(`${BASE}/${projectId}/create`, json('POST', body)),
  /** AI 分析表格风格用的样本 */
  sample: (projectId: string) => request<{ text: string; files: number }>(`${BASE}/${projectId}/sample`),
  /** AI 分析表格风格的第一句话（服务端读好样本、按面板的回复语言拼好） */
  analyzePrompt: (projectId: string) => request<{ prompt: string }>(`${BASE}/${projectId}/analyze-prompt`),
  /** 版本记录 */
  history: (projectId: string, path: string) => request<TableHistory>(`${BASE}/${projectId}/history?path=${q(path)}`),
  /** 某一版的内容 */
  at: (projectId: string, path: string, rev: string) =>
    request<{ sheets: SheetData[] }>(`${BASE}/${projectId}/at?path=${q(path)}&rev=${q(rev)}`),
  /** 一格的历史：哪几次提交改过它 */
  cellHistory: (projectId: string, path: string, at: CellAt) =>
    request<CellHistory>(
      `${BASE}/${projectId}/cell-history?path=${q(path)}&` +
        new URLSearchParams(Object.entries(at).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]]))),
    ),
  /** 跨项目对比：按相对路径配对 */
  compare: (projectId: string, other: string) =>
    request<{ pairs: TablePair[]; truncated?: boolean }>(`${BASE}/${projectId}/compare?other=${q(other)}`),
  /** 跨项目批量同步：apply=false 只预览 */
  sync: (
    projectId: string,
    body: { other: string; items: SyncItem[]; mode: 'file' | 'column'; field?: string; apply: boolean },
  ) => request<{ results: SyncResult[] }>(`${BASE}/${projectId}/sync`, json('POST', body)),
  /** 在系统的文件管理器里显示 */
  reveal: (projectId: string, path: string) =>
    request<{ ok: true }>(`${BASE}/${projectId}/reveal`, json('POST', { path })),
  /** AI 提的改动（还没写进文件） */
  proposal: (projectId: string, path: string) =>
    request<{ proposal: TableProposal | null }>(`${BASE}/${projectId}/proposal?path=${q(path)}`),
  dropProposal: (projectId: string, path: string, id: string) =>
    request<{ ok: true }>(`${BASE}/${projectId}/proposal?path=${q(path)}&pid=${q(id)}`, { method: 'DELETE' }),
  /** 全项目检查 */
  check: (projectId: string, all = false) => request<TablesCheck>(`${BASE}/${projectId}/check${all ? '?all=1' : ''}`),
  /** 把本地文件切换到某一版：返回切换后的文件 */
  checkout: (projectId: string, path: string, rev: string) =>
    request<TableDoc>(`${BASE}/${projectId}/checkout`, json('POST', { path, rev })),
  runExport,
  /** 这个文件在版本管理里的状态 */
  vcsStatus: (projectId: string, path: string) => request<VcsStatus>(`${BASE}/${projectId}/vcs-status?path=${q(path)}`),
  /** 只提交这一个文件 */
  vcsSubmit: (projectId: string, path: string, message: string) =>
    request<{ vcs: string; out: string }>(`${BASE}/${projectId}/vcs-submit`, json('POST', { path, message })),
  /** 开始合并冲突：共同祖先、对方的内容；replaced 时工作区文件换成了干净的我这边，要重新载入 */
  mergeStart: (projectId: string, path: string) =>
    request<MergeSources>(`${BASE}/${projectId}/merge-start`, json('POST', { path })),
  /** 合并保存后标记冲突已解决 */
  vcsResolve: (projectId: string, path: string) =>
    request<VcsStatus>(`${BASE}/${projectId}/vcs-resolve`, json('POST', { path })),
  /** 枚举值改名后替换所有表里的旧值；apply=false 只预览 */
  enumRename: (projectId: string, renames: EnumRename[], apply: boolean) =>
    request<EnumRenameResult>(`${BASE}/${projectId}/enum-rename`, json('POST', { renames, apply })),
}

export interface TableProposal {
  id: string
  path: string
  sheet: string
  mtime: string
  edit: SheetEdit
  note: string
  cells: number
  added: number
  removed: number
  at: string
}

export interface SyncItem {
  path: string
  left?: string
  right?: string
}

export interface SyncResult {
  path: string
  action: 'create' | 'replace' | 'cells' | 'same' | 'skip'
  cells: number
  missing?: number
  error?: string
}

export interface VcsStatus {
  vcs: 'git' | 'p4' | 'svn' | 'none'
  changed: boolean
  conflict: boolean
  error?: string
}

export interface MergeSources {
  vcs: string
  base: SheetData[]
  theirs: SheetData[]
  theirsLabel: string
  replaced: boolean
}

export interface CellHistory {
  vcs: string
  changes: CellChange<TableRev>[]
  scanned: number
  error?: string
}

export interface EnumRenameResult {
  files: { path: string; cells: number }[]
  failed: { path: string; error: string }[]
  applied: boolean
}

/** 执行导表脚本：服务端一行一个 JSON 边跑边推，每收到一条回调一次；signal 停止（服务端跟着停掉命令） */
async function runExport(
  projectId: string,
  script: number,
  paths: string[],
  onEvent: (e: ExportEvent) => void,
  signal?: AbortSignal,
) {
  const url = `${BASE}/${projectId}/export`
  // 演示版没有后端：模拟出整串消息，隔一会儿放一条
  if (import.meta.env.VITE_DEMO) {
    const events = await request<ExportEvent[]>(url, json('POST', { script, paths }))
    for (const e of events) {
      if (signal?.aborted) return
      await new Promise((r) => setTimeout(r, 120))
      onEvent(e)
    }
    return
  }
  const res = await trackedFetch(`/api${url}`, {
    ...json('POST', { script, paths }),
    headers: { 'Content-Type': 'application/json' },
    signal,
  })
  if (!res.ok) await failure(res)
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) onEvent(JSON.parse(line) as ExportEvent)
    }
  }
}

export interface TableRev {
  id: string
  label: string
  author: string
  time: string
  message: string
}
export interface TableHistory {
  vcs: 'git' | 'p4' | 'svn' | 'none'
  base: string
  revs: TableRev[]
  error?: string
}
export interface TablePair {
  /** 配对用的路径（项目目录外的表格目录是「目录名/里面的路径」） */
  path: string
  /** 和 path 不一样时，两边各自的真实路径 */
  left?: string
  right?: string
  status: 'same' | 'diff' | 'left' | 'right' | 'error'
  error?: string
}

export interface TablesCheck {
  files: number
  sheets: SheetProblems[]
  failed: { path: string; error: string }[]
}

/** 按还没保存的表格配置找一遍的结果 */
export interface TablesProbe {
  roots: TableRoot[]
  files: number
  /** 前几个文件的路径 */
  sample: string[]
  truncated?: boolean
}
