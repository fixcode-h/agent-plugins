import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../types.ts'
import { indexedTree } from '../file-index.ts'
import { c, readJson, run, writeJson } from '../util.ts'

/**
 * 增量编译编哪些文件（设计稿四.3）：比文件修改时间，晚于「上次编译成功」的算改过；P4 项目再加上已经签出的 .lua。
 * 「上次编译成功」按文件记：增量编过的文件记下编的那一刻的修改时间，全编译成功记一个总的时间点。
 * 一次都没编成功过的项目没有基准，不猜，网页提示先全编译一次
 */
export interface BuildSummary {
  at: number
  ms: number
  files: number
  ok: boolean
}

export interface BuildState {
  /** 全编译成功的时刻 */
  fullOkAt?: number
  /** 第一次编译成功的时刻（只增量编过、没全编译过的项目拿它当基准） */
  firstOkAt?: number
  /** 增量编过的文件（相对脚本目录）→ 编的那一刻的修改时间 */
  built: Record<string, number>
  last: { full?: BuildSummary; incremental?: BuildSummary }
}

export interface ChangedFile {
  /** 相对脚本目录，/ 分隔 */
  path: string
  mtime: number
  /** P4 里签出了（不论修改时间） */
  p4?: boolean
}

const MAX_FILES = 50000

const stateFile = (projectId: string) => path.join(c().dataDir, 'lua-build', projectId, 'state.json')

export const readBuildState = (projectId: string) => readJson<BuildState>(stateFile(projectId), { built: {}, last: {} })

export async function patchBuildState(projectId: string, f: (s: BuildState) => void) {
  const s = await readBuildState(projectId)
  f(s)
  await writeJson(stateFile(projectId), s)
  return s
}

/** 脚本目录下所有 .lua 和修改时间（跳过 . 开头的目录） */
export async function luaFiles(dir: string): Promise<{ path: string; mtime: number }[]> {
  const out: { path: string; mtime: number }[] = []
  // 面板有项目文件索引时文件清单直接取，只 stat 这些 .lua 拿修改时间
  const listed = await indexedTree(dir, /(^|\/)[^.][^/]*\.lua$/i)
  if (listed && !listed.some((r) => r.split('/').slice(0, -1).some((s) => s.startsWith('.')))) {
    for (const rel of listed.slice(0, MAX_FILES)) {
      const st = await stat(path.join(dir, ...rel.split('/'))).catch(() => undefined)
      if (st) out.push({ path: rel, mtime: st.mtimeMs })
    }
    return out
  }
  async function walk(d: string) {
    if (out.length >= MAX_FILES) return
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const f = path.join(d, e.name)
      if (e.isDirectory()) await walk(f)
      else if (e.isFile() && /\.lua$/i.test(e.name)) {
        const st = await stat(f).catch(() => undefined)
        if (st) out.push({ path: path.relative(dir, f).replace(/\\/g, '/'), mtime: st.mtimeMs })
      }
    }
  }
  await walk(dir)
  return out
}

/** P4 里签出的 .lua（相对脚本目录）：p4 不在或没登录时返回原因，网页上照样列按时间找到的 */
async function p4Opened(p: UeProject, dir: string): Promise<{ files: string[]; error?: string }> {
  if (p.vcs !== 'p4') return { files: [] }
  const r = await run('p4', ['-d', dir, '-ztag', 'fstat', '-Ro', '-T', 'clientFile', path.join(dir, '....lua')], {
    cwd: dir,
    timeout: 8000,
  })
  // 没有签出的文件时 p4 也返回非 0（file(s) not opened），不算出错
  if (r.code !== 0 && !/not opened|no such file/i.test(r.err + r.out))
    return { files: [], error: (r.err || r.out).trim().split('\n')[0] }
  const files = [...r.out.matchAll(/^\.\.\. clientFile (.+)$/gm)]
    .map((m) => path.relative(dir, m[1].trim()).replace(/\\/g, '/'))
    .filter((f) => !f.startsWith('..'))
  return { files }
}

export async function changedFiles(p: UeProject, dir: string) {
  const [all, state, p4] = await Promise.all([luaFiles(dir), readBuildState(p.id), p4Opened(p, dir)])
  const base = state.fullOkAt ?? state.firstOkAt
  const opened = new Set(p4.files)
  const files: ChangedFile[] = []
  for (const f of all) {
    const since = Math.max(base ?? 0, state.built[f.path] ?? 0)
    const newer = base !== undefined && f.mtime > since + 1
    if (newer || opened.has(f.path)) files.push({ ...f, ...(opened.has(f.path) ? { p4: true } : {}) })
  }
  files.sort((a, b) => b.mtime - a.mtime)
  return { files, total: all.length, baseline: base ?? null, last: state.last, p4Error: p4.error }
}

/** 文件（相对脚本目录）→ UnLua 的模块名：UI/BagPanel.lua → UI.BagPanel */
export const moduleName = (rel: string) => rel.replace(/\.lua$/i, '').replace(/[\\/]/g, '.')
