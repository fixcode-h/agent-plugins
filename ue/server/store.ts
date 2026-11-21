import { existsSync } from 'node:fs'
import path from 'node:path'
import { GM_VERSION, GmStore as GmSchema, parseGm, type GmStore } from '../shared/gm/schema.ts'
import { docsRoot, legacyDocsRoot } from './doc-root.ts'
import type { UeProject } from './types.ts'
import { c, readJson, writeJson } from './util.ts'

/**
 * GM 的东西（gm.json v2：预设、宏、表格关联、对象列表、自定义 GM、模块、收藏，契约见 shared/gm/schema.ts）：
 * 默认存在项目文档根的 AgentPanel/UE/gm.json（用户 2026-11-21：GM 相关的都默认放 docs 下，和 Lua GM 扫描设置同一个目录，
 * 可以提交、团队共用）；项目设置选「只在本机」时存插件数据目录。控制台历史、监视列表、GM 最近执行只存本机（下面的 LocalState）。
 * gm.json 改了（网页、Agent 的 ue_gm save / remove、别人提交后拉下来）都推 gm 事件给网页（gm-custom/watch.ts），不轮询
 */
export const GM_EVENT = 'gm'

type P = Pick<UeProject, 'id' | 'root' | 'gmStore'>

export const gmFile = (p: P) =>
  p.gmStore === 'local'
    ? path.join(c().dataDir, 'gm', `${encodeURIComponent(p.id)}.json`)
    : path.join(docsRoot(p), 'AgentPanel', 'UE', 'gm.json')

/** 以前放过 gm.json 的地方：项目的 .agent-panel/ue、升级前按旧规则猜的文档根 */
const oldGmFiles = (p: P) => [
  path.join(p.root, '.agent-panel', 'ue', 'gm.json'),
  path.join(legacyDocsRoot(p.root), 'AgentPanel', 'UE', 'gm.json'),
]

/**
 * 新位置还没有 gm.json、旧位置有：第一次读时搬过来（用户 2026-11-21）。只带预设、宏和表格关联——
 * 旧的收藏 favGm / favConsole 照规格第 1 节不再读；旧文件留着不删（可能已经提交进版本管理，删不删由用户定）
 */
async function adoptOldGm(p: P, file: string) {
  if (p.gmStore === 'local' || existsSync(file)) return
  const old = oldGmFiles(p).find((f) => path.resolve(f) !== path.resolve(file) && existsSync(f))
  if (!old) return
  const raw = await readJson<Record<string, unknown>>(old, {})
  const next =
    raw.version === GM_VERSION
      ? parseGm(raw)
      : GmSchema.parse({
          version: GM_VERSION,
          presets: raw.presets ?? [],
          macros: raw.macros ?? [],
          ...(raw.bindings ? { bindings: raw.bindings } : {}),
          ...(raw.tableBindings ? { tableBindings: raw.tableBindings } : {}),
        })
  await writeJson(file, next)
  c().log?.info('UE：gm.json 搬到项目文档根', { project: p.id, from: old, to: file })
}

export async function readGm(p: P): Promise<GmStore> {
  const file = gmFile(p)
  await adoptOldGm(p, file).catch((e: Error) => c().log?.warn('UE：旧 gm.json 没搬过来', { error: e.message }))
  return parseGm(await readJson<unknown>(file, null))
}

/** 写之前按契约校验（网页整份传上来的、Agent 拼的都过一遍），写完推 gm 事件让打开着的 GM 页刷新 */
export async function writeGm(p: P, data: unknown) {
  const next = GmSchema.parse(data)
  await writeJson(gmFile(p), next)
  c().pages?.push(GM_EVENT, { project: p.id })
  return next
}

export interface LocalState {
  /** 控制台历史（新的在后），最多 200 条 */
  console: string[]
  /** 监视：对象路径 + 属性路径 */
  watch: { path: string; prop: string; label?: string; target?: string }[]
  /** Object 页最近搜过的（「类::名字开头」，UObject 时只有名字开头）和固定的对象 */
  recent: string[]
  pinned: { path: string; label: string }[]
  /** 资源页文件夹树里收藏的文件夹（包路径 /Game/Data） */
  folders: string[]
  /** GM 页最近执行的（新的在前，最多 60 条）：只存本机，点一行把参数填回去 */
  gmRecent: GmRun[]
}
export interface GmRun {
  /** GM 页里的条目 key（lua:名字 / cpp:类.名字 / custom:id） */
  key: string
  name: string
  /** 按顺序的参数；自定义 GM 是 {参数名: 值} */
  args: string[] | Record<string, unknown>
  /** 实际执行的：Lua 代码或控制台写法 */
  code: string
  ok: boolean
  /** 输出的头一行或报错 */
  out: string
  at: string
}
const LOCAL: LocalState = { console: [], watch: [], recent: [], pinned: [], folders: [], gmRecent: [] }
const localFile = (id: string) => path.join(c().dataDir, 'local', `${encodeURIComponent(id)}.json`)

export async function readLocal(id: string): Promise<LocalState> {
  return { ...LOCAL, ...(await readJson<Partial<LocalState>>(localFile(id), {})) }
}
export async function patchLocal(id: string, patch: Partial<LocalState>) {
  const next = { ...(await readLocal(id)), ...patch }
  next.console = next.console.slice(-200)
  next.recent = next.recent.slice(0, 12)
  next.folders = (next.folders ?? []).slice(0, 50)
  await writeJson(localFile(id), next)
  return next
}
export async function pushConsoleHistory(id: string, cmd: string) {
  const s = await readLocal(id)
  await patchLocal(id, { console: [...s.console.filter((x) => x !== cmd), cmd] })
}
