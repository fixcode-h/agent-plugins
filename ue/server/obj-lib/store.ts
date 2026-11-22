import { existsSync } from 'node:fs'
import path from 'node:path'
import { OBJ_LIB_VERSION, ObjLib, parseObjLib, type ObjLib as Lib } from '../../shared/obj-lib/schema.ts'
import { docsRoot } from '../doc-root.ts'
import type { UeProject } from '../types.ts'
import { c, readJson, writeJson } from '../util.ts'

type P = Pick<UeProject, 'id' | 'root' | 'gmStore'>

/** 对象库的位置：跟着 gm.json 走（同一个目录；项目设置选「只在本机」时也一起放插件数据目录） */
export const objLibFile = (p: P) =>
  p.gmStore === 'local'
    ? path.join(c().dataDir, 'gm', `${encodeURIComponent(p.id)}.objects.json`)
    : path.join(docsRoot(p), 'AgentPanel', 'UE', 'objects.json')

/**
 * 读对象库。还没有 objects.json、gm.json 里有对象列表时（0.53.0 以前存的）一次性搬过来：写 objects.json，
 * 再把 gm.json 里的 objects / objFolders 删掉（照项目规则写一次性迁移，不在读时两边兼容）。gmRaw 是调用方刚读的 gm.json 原文
 */
export async function readObjLib(p: P, gmFile: string, gmRaw?: unknown): Promise<Lib> {
  const file = objLibFile(p)
  if (existsSync(file)) return parseObjLib(await readJson<unknown>(file, null))
  const raw = (gmRaw === undefined ? await readJson<unknown>(gmFile, null) : gmRaw) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || !('objects' in raw || 'objFolders' in raw)) return parseObjLib(null)
  const lib = ObjLib.parse({ version: OBJ_LIB_VERSION, objects: raw.objects ?? [], objFolders: raw.objFolders ?? [] })
  await writeJson(file, lib)
  const { objects: _o, objFolders: _f, ...rest } = raw
  await writeJson(gmFile, rest)
  c().log?.info('UE：对象列表从 gm.json 搬到 objects.json', { project: p.id, file, objects: lib.objects.length })
  return lib
}

/** 写对象库：和现在的一样就不写（GM 页整份存 gm.json 时也会带上对象列表，没改就别动文件、免得版本管理里多一笔） */
export async function writeObjLib(p: P, data: Pick<Lib, 'objects' | 'objFolders'>) {
  const next = ObjLib.parse({ version: OBJ_LIB_VERSION, ...data })
  const file = objLibFile(p)
  const cur = existsSync(file) ? await readJson<unknown>(file, null) : null
  if (JSON.stringify(cur) !== JSON.stringify(next)) await writeJson(file, next)
  return next
}
