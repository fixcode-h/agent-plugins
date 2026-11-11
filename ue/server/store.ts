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
}
const LOCAL: LocalState = { console: [], watch: [], recent: [], pinned: [] }
const localFile = (id: string) => path.join(c().dataDir, 'local', `${encodeURIComponent(id)}.json`)

export async function readLocal(id: string): Promise<LocalState> {
  return { ...LOCAL, ...(await readJson<Partial<LocalState>>(localFile(id), {})) }
}
export async function patchLocal(id: string, patch: Partial<LocalState>) {
  const next = { ...(await readLocal(id)), ...patch }
  next.console = next.console.slice(-200)
  next.recent = next.recent.slice(0, 12)
  await writeJson(localFile(id), next)
  return next
}
export async function pushConsoleHistory(id: string, cmd: string) {
  const s = await readLocal(id)
  await patchLocal(id, { console: [...s.console.filter((x) => x !== cmd), cmd] })
}
