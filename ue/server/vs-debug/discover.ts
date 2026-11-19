import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { solutionDirs } from '../search-index/uetovs.ts'
import type { UeProject } from '../types.ts'
import { readJson } from '../util.ts'
import { pidAlive } from './instances.ts'
import type { Endpoint } from './protocol.ts'

/**
 * 找 UE 项目的解决方案和 VS 调试控制的发现文件。
 * UE 生成的 .sln 一般和 .uproject 同目录，也可能在外层（多项目共用）或源码版引擎的根目录：候选目录和
 * search-index/uetovs.ts 读 UEToVS 索引用同一份（solutionDirs），UEToVS 的 .vs/UEToVS 就在 .sln 旁边
 */
export const ENDPOINT_REL = path.join('.vs', 'UEToVS', 'Debug', 'endpoint.json')

type ProjectLike = Pick<UeProject, 'root' | 'engineDir'> & {
  uname?: string
  uproject?: string
  engine?: { dir?: string }
}

const norm = (s: string) => path.resolve(s).replace(/\\/g, '/').toLowerCase()

/** 第一个有 .sln 的候选目录里的解决方案：同名（<项目名>.sln）优先；都没有返回空 */
export async function findSolution(p: ProjectLike): Promise<string | undefined> {
  for (const dir of solutionDirs(p)) {
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /\.sln$/i.test(n))
    if (!names.length) continue
    const same = p.uname && names.find((n) => n.toLowerCase() === `${p.uname!.toLowerCase()}.sln`)
    return path.join(dir, same || names.sort()[0])
  }
  return undefined
}

export interface FoundEndpoint {
  endpoint: Endpoint
  file: string
  mtimeMs: number
}

/**
 * 发现文件：几个候选目录都看，写着这个 .uproject 的优先（外层解决方案可能是别的项目的 VS 开着），
 * 再按新旧取。写了 PID 而进程已经不在的（VS 关了或崩了没删）直接不算，免得卡片报「连不上管道」；
 * 进程在也不代表管道在，连不连得上由调用方去连
 */
export async function findEndpoint(p: ProjectLike): Promise<FoundEndpoint | undefined> {
  const found: FoundEndpoint[] = []
  for (const dir of solutionDirs(p)) {
    const file = path.join(dir, ENDPOINT_REL)
    const st = await stat(file).catch(() => undefined)
    if (!st?.isFile()) continue
    const endpoint = await readJson<Endpoint | null>(file, null)
    if (!endpoint || typeof endpoint.pipe !== 'string' || typeof endpoint.token !== 'string') continue
    if (typeof endpoint.pid === 'number' && !pidAlive(endpoint.pid)) continue
    found.push({ endpoint, file, mtimeMs: st.mtimeMs })
  }
  const mine = (f: FoundEndpoint) =>
    !!p.uproject && !!f.endpoint.project && norm(f.endpoint.project) === norm(p.uproject) ? 1 : 0
  return found.sort((a, b) => mine(b) - mine(a) || b.mtimeMs - a.mtimeMs)[0]
}
