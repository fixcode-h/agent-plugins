import { existsSync } from 'node:fs'
import path from 'node:path'
import { GM_VERSION, GmStore as GmSchema, parseGm, type GmStore } from '../shared/gm/schema.ts'
import { docsRoot, legacyDocsRoot } from './doc-root.ts'
import { readObjLib, writeObjLib } from './obj-lib/store.ts'
import type { UeProject } from './types.ts'
import { c, readJson, writeJson } from './util.ts'

/**
 * GM 的东西（gm.json v2：宏、表格关联、对象列表、自定义 GM、模块、常用，契约见 shared/gm/schema.ts）：
 * 默认存在项目文档根的 AgentPanel/UE/gm.json（用户 2026-11-21：GM 相关的都默认放 docs 下，和 Lua GM 扫描设置同一个目录，
 * 可以提交、团队共用）；项目设置选「只在本机」时存插件数据目录。控制台历史、监视列表、GM 最近执行只存本机（下面的 LocalState）。
 * gm.json 改了（网页、Agent 的 ue_gm save / remove、别人提交后拉下来）都推 gm 事件给网页（gm-custom/watch.ts），不轮询
 */
export const GM_EVENT = 'gm'
/** Agent 在服务端记了一条调用记录（ue_gm action=call）：开着的 GM 页重读本机状态 */
export const GM_RECENT_EVENT = 'gm-recent'

type P = Pick<UeProject, 'id' | 'root' | 'gmStore'>

/** 每个项目最近一次算出的 gm.json 位置：工具的 targets 是同步的、拿不到项目，按它报（没算过就报不出，给空） */
const seenGmFile = new Map<string, string>() // 模块状态：只是缓存，重启后第一次读写 gm.json 时补上
export const gmFile = (p: P) => {
  const f =
    p.gmStore === 'local'
      ? path.join(c().dataDir, 'gm', `${encodeURIComponent(p.id)}.json`)
      : path.join(docsRoot(p), 'AgentPanel', 'UE', 'gm.json')
  seenGmFile.set(p.id, f)
  return f
}
export const knownGmFile = (projectId: string) => {
  const f = seenGmFile.get(projectId)
  return f ? [f] : []
}

/** 以前放过 gm.json 的地方：项目的 .agent-panel/ue、升级前按旧规则猜的文档根 */
const oldGmFiles = (p: P) => [
  path.join(p.root, '.agent-panel', 'ue', 'gm.json'),
  path.join(legacyDocsRoot(p.root), 'AgentPanel', 'UE', 'gm.json'),
]

/**
 * 新位置还没有 gm.json、旧位置有：第一次读时搬过来（用户 2026-11-21）。只带宏和表格关联——
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
          macros: raw.macros ?? [],
          ...(raw.bindings ? { bindings: raw.bindings } : {}),
          ...(raw.tableBindings ? { tableBindings: raw.tableBindings } : {}),
        })
  await writeJson(file, next)
  c().log?.info('UE：gm.json 搬到项目文档根', { project: p.id, from: old, to: file })
}

/**
 * 读 GM 的东西：gm.json + 对象库 objects.json（0.53.0 起对象列表单独存，GM 页和测试页共用，obj-lib/store.ts）。
 * 合成一份交出去，GM 页和 ue_gm 照旧按 GmStore 用
 */
export async function readGm(p: P): Promise<GmStore> {
  const file = gmFile(p)
  await adoptOldGm(p, file).catch((e: Error) => c().log?.warn('UE：旧 gm.json 没搬过来', { error: e.message }))
  const raw = await readJson<unknown>(file, null)
  const lib = await readObjLib(p, file, raw)
  return { ...parseGm(raw), objects: lib.objects, objFolders: lib.objFolders }
}

/**
 * 写之前按契约校验（网页整份传上来的、Agent 拼的都过一遍）：对象列表写进 objects.json，其余写 gm.json；
 * 写完推 gm 事件让打开着的 GM 页、测试页刷新
 */
export async function writeGm(p: P, data: unknown) {
  const next = GmSchema.parse(data)
  const { objects, objFolders, ...rest } = next
  await writeObjLib(p, { objects, objFolders })
  await writeJson(gmFile(p), rest)
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
  /**
   * 对象调用的一次（GM 页「调用记录」，2026-11-22）：key 是 `objcall:<对象名>`，这里记能填回工作台的东西。
   * mode：call 调函数 / get 读取 / set 改值；fn 是函数名或属性路径
   */
  call?: { obj: string; mode: 'call' | 'get' | 'set'; fn?: string; props?: string[]; many?: string }
}
const LOCAL: LocalState = { console: [], watch: [], recent: [], pinned: [], folders: [], gmRecent: [] }
const localFile = (id: string) => path.join(c().dataDir, 'local', `${encodeURIComponent(id)}.json`)

export async function readLocal(id: string): Promise<LocalState> {
  return { ...LOCAL, ...(await readJson<Partial<LocalState>>(localFile(id), {})) }
}
/**
 * 同一个项目的本机状态一次只改一处：两次执行几乎同时回来时（宏、右键连点），各自「读—改—写」会互相盖掉（B3）。
 * 按项目排队，前一个写完再读下一个
 */
const queues = new Map<string, Promise<unknown>>()
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(id) ?? Promise.resolve()).then(fn, fn)
  queues.set(
    id,
    run.catch(() => undefined),
  )
  return run
}

export const patchLocal = (id: string, patch: Partial<LocalState>) => serial(id, () => patchLocalNow(id, patch))

/** 最近执行追加一条（新的在前，最多 60 条）：网页只发这一条，不整份写回 */
export const pushGmRecent = (id: string, run: GmRun) =>
  serial(id, async () => {
    const s = await readLocal(id)
    return patchLocalNow(id, { gmRecent: [run, ...(s.gmRecent ?? [])].slice(0, 60) })
  })

async function patchLocalNow(id: string, patch: Partial<LocalState>) {
  const next = { ...(await readLocal(id)), ...patch }
  next.console = next.console.slice(-200)
  next.recent = next.recent.slice(0, 12)
  next.folders = (next.folders ?? []).slice(0, 50)
  await writeJson(localFile(id), next)
  return next
}
export const pushConsoleHistory = (id: string, cmd: string) =>
  serial(id, async () => {
    const s = await readLocal(id)
    await patchLocalNow(id, { console: [...s.console.filter((x) => x !== cmd), cmd] })
  })
