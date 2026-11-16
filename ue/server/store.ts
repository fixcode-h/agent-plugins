import path from 'node:path'
import type { GmStore, UeProject } from './types.ts'
import { c, readJson, writeJson } from './util.ts'

/**
 * GM 预设、宏和收藏（设计文档 3.3）：默认存在项目里 .agent-panel/ue/gm.json（可以提交，团队共用），
 * 也可以只存在插件数据目录；控制台历史和监视列表只存本机。
 */
const EMPTY: GmStore = { presets: [], macros: [], favConsole: [], favGm: [] }

const gmFile = (p: UeProject) =>
  p.gmStore === 'local'
    ? path.join(c().dataDir, 'gm', `${encodeURIComponent(p.id)}.json`)
    : path.join(p.root, '.agent-panel', 'ue', 'gm.json')

export async function readGm(p: UeProject): Promise<GmStore> {
  return { ...EMPTY, ...(await readJson<Partial<GmStore>>(gmFile(p), {})) }
}
export async function writeGm(p: UeProject, data: GmStore) {
  await writeJson(gmFile(p), data)
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
  /** GM 页里的条目 key（lua:名字 / cpp:类.名字） */
  key: string
  name: string
  args: string[]
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
