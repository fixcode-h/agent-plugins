import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { adoptProjectStore, refreshDocsRoot } from './doc-root.ts'
import { localPart, mergeLuaBuild } from './lua-build/store.ts'
import type { UeProject } from './types.ts'
import { c, now, readJson, writeJson } from './util.ts'

/** 接入的 UE 项目：插件数据目录 projects/<面板项目 id>.json（设计文档 4.5：不改面板核心的项目结构） */
const dir = () => path.join(c().dataDir, 'projects')
const file = (id: string) => path.join(dir(), `${encodeURIComponent(id)}.json`)

export const DEFAULT_PERMS: UeProject['perms'] = { runtime: 'write', asset: 'save', struct: 'allow', python: 'allow' }

/** 老数据的 python 是布尔值：开着的照旧每次问，关着的不允许 */
function pythonPerm(v: unknown): UeProject['perms']['python'] {
  if (v === true) return 'ask'
  if (v === false) return 'read'
  return v === 'read' || v === 'ask' || v === 'allow' ? v : DEFAULT_PERMS.python
}

/** 补齐老数据缺的字段 */
function norm(p: UeProject): UeProject {
  return {
    ...p,
    perms: { ...DEFAULT_PERMS, ...p.perms, python: pythonPerm(p.perms?.python) },
    gmStore: p.gmStore === 'local' ? 'local' : 'docs',
    buildCmd: p.buildCmd ?? '',
    engineDir: p.engineDir ?? '',
    target: p.target ?? { kind: '', world: '' },
  }
}

export async function listProjects(): Promise<UeProject[]> {
  const out: UeProject[] = []
  for (const n of await readdir(dir()).catch(() => [] as string[])) {
    if (!n.endsWith('.json')) continue
    const p = await readJson<UeProject | null>(path.join(dir(), n), null)
    if (p?.id) out.push(p)
  }
  const loaded = await Promise.all(out.map((p) => load(p)))
  return loaded.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

export async function getProject(id: string): Promise<UeProject | undefined> {
  const p = await readJson<UeProject | null>(file(id), null)
  return p ? load(p) : undefined
}

/** 登记文件里以前有、已经不用的字段：读到时搬家（load）再从文件里去掉 */
type Stored = UeProject & { favStore?: string }

/**
 * 读项目：文档根问面板（doc-root.ts），项目存放的脚本、收藏都按它找，取项目时顺手取好，后面同步用；
 * 再把文档根里团队共用的 Lua 编译设置合进来（lua-build/store.ts）。升级前存的东西在这里一次性搬家
 */
async function load(raw: Stored): Promise<UeProject> {
  await refreshDocsRoot(raw)
  let rewrite = false
  // 以前「收藏存哪」选了项目 .agent-panel/ue 的（2026-11-21 起统一存文档根）：那边的文件复制过来
  if ('favStore' in raw) {
    if (raw.favStore === 'project') await adoptProjectStore(raw)
    delete raw.favStore
    rewrite = true
  }
  const lb = await mergeLuaBuild(raw)
  if (rewrite || lb.strip) await saveProject(raw)
  return norm({ ...raw, luaBuild: lb.luaBuild })
}

/** 存项目登记：Lua 编译设置只存个人那部分，团队共用的在文档根（lua-build/store.ts） */
export async function saveProject(p: UeProject) {
  await writeJson(file(p.id), { ...p, luaBuild: localPart(p.luaBuild), addedAt: p.addedAt || now() })
}

export async function patchProject(id: string, patch: Partial<UeProject>) {
  const p = await getProject(id)
  if (!p) throw new Error(`UE project ${id} not found`)
  const next = { ...p, ...patch, perms: { ...p.perms, ...patch.perms } }
  await saveProject(next)
  return next
}

export async function removeProject(id: string) {
  await rm(file(id), { force: true })
}

/**
 * 对话属于哪个 UE 项目：先按面板项目 id，再按目录（对话在 worktree 或子目录里时 cwd 落在项目根下面）
 */
export async function projectForRun(projectId?: string, cwd?: string) {
  const all = await listProjects()
  const byId = projectId ? all.find((p) => p.id === projectId) : undefined
  if (byId) return byId
  if (!cwd) return undefined
  const norm = (s: string) => path.resolve(s).toLowerCase()
  const here = norm(cwd)
  return all.find((p) => here === norm(p.root) || here.startsWith(norm(p.root) + path.sep))
}
