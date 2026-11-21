import path from 'node:path'
import type { UeProject } from '../types.ts'
import { exists, run } from '../util.ts'

/**
 * GM 参数关联表格的路径相对谁存（用户 2026-11-21，写法见 shared/gm/table-path.ts）：项目在版本管理里时相对版本管理根，
 * 团队成员检出到哪都对得上；找不到时相对 UE 项目根。
 * 版本管理根：从 UE 项目根往上找 .git（目录或文件，worktree / 子模块是文件）、.hg、.plastic、P4CONFIG 文件；
 * .svn 取连续有 .svn 的最外层（老版本 SVN 每层都有）。都没有时问 p4 的工作区根（client root），包含项目才用
 */
export interface TableBase {
  base: string
  kind: 'vcs' | 'project'
}

const cache = new Map<string, TableBase>() // 模块状态：缓存，丢了重找（面板进程里项目不会挪位置）

const P4_FILES = () => [process.env.P4CONFIG, '.p4config', 'p4config.txt'].filter((x): x is string => !!x)

export function findVcsRoot(start: string): string | undefined {
  let d = path.resolve(start)
  let svn: string | undefined
  for (let i = 0; i < 32; i++) {
    if (['.git', '.hg', '.plastic'].some((m) => exists(path.join(d, m)))) return d
    if (P4_FILES().some((f) => exists(path.join(d, f)))) return d
    if (exists(path.join(d, '.svn'))) svn = d
    else if (svn) return svn
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  return svn
}

async function p4Root(root: string) {
  const r = await run('p4', ['-F', '%clientRoot%', '-ztag', 'info'], { cwd: root, timeout: 4000 })
  const got = r.code === 0 ? r.out.trim().split(/\r?\n/)[0]?.trim() : ''
  if (!got || got === '*unknown*' || got === 'null') return undefined
  const rel = path.relative(path.resolve(got), root)
  return !rel.startsWith('..') && !path.isAbsolute(rel) ? path.resolve(got) : undefined
}

export async function tableBase(p: Pick<UeProject, 'id' | 'root' | 'vcs'>): Promise<TableBase> {
  const hit = cache.get(p.id)
  if (hit) return hit
  const vcs = findVcsRoot(p.root) ?? (p.vcs === 'p4' ? await p4Root(p.root) : undefined)
  const r: TableBase = vcs
    ? { base: vcs.replace(/\\/g, '/'), kind: 'vcs' }
    : { base: p.root.replace(/\\/g, '/'), kind: 'project' }
  cache.set(p.id, r)
  return r
}
