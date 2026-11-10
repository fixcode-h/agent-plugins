import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from './types.ts'
import { c, now, readJson, writeJson } from './util.ts'

/** 接入的 UE 项目：插件数据目录 projects/<面板项目 id>.json（设计文档 4.5：不改面板核心的项目结构） */
const dir = () => path.join(c().dataDir, 'projects')
const file = (id: string) => path.join(dir(), `${encodeURIComponent(id)}.json`)

export const DEFAULT_PERMS: UeProject['perms'] = { runtime: 'write', asset: 'ask' }

/** 补齐老数据缺的字段 */
function norm(p: UeProject): UeProject {
  return {
    ...p,
    perms: { ...DEFAULT_PERMS, ...p.perms },
    gmStore: p.gmStore ?? 'project',
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
    if (p?.id) out.push(norm(p))
  }
  return out.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

export async function getProject(id: string): Promise<UeProject | undefined> {
  const p = await readJson<UeProject | null>(file(id), null)
  return p ? norm(p) : undefined
}

export async function saveProject(p: UeProject) {
  await writeJson(file(p.id), { ...p, addedAt: p.addedAt || now() })
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
