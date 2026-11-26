import { existsSync } from 'node:fs'
import path from 'node:path'
import type { LuaBuildError } from '../types.ts'

/** 编译输出里的颜色控制符：认报错和给人看之前都去掉 */
// oxlint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
export const stripAnsi = (s: string) => s.replace(ANSI, '')

export interface ErrorDirs {
  root: string
  cwd: string
  scriptDir: string
}

/**
 * 按报错格式（config.ts 的 compileErrorPattern）认一行输出里的 文件:行。
 * 编译器给的路径可能相对工作目录、脚本目录或项目根，依次找磁盘上真有的那个；都没有时按工作目录算，标成找不到（不能点开）
 */
export function parseErrorLine(re: RegExp, line: string, dirs: ErrorDirs): LuaBuildError | undefined {
  const m = re.exec(stripAnsi(line))
  const g = m?.groups
  if (!g?.file || !g.line) return undefined
  const lineNo = Number(g.line)
  if (!Number.isFinite(lineNo)) return undefined
  const raw = g.file.trim().replace(/^["']|["']$/g, '')
  const abs = resolveFile(raw, dirs)
  const rel = path.relative(dirs.root, abs.path)
  const file = (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs.path).replace(/\\/g, '/')
  return {
    file,
    line: lineNo,
    ...(g.col ? { col: Number(g.col) } : {}),
    message: (g.message ?? g.msg ?? '').trim() || stripAnsi(line).trim(),
    exists: abs.exists,
  }
}

function resolveFile(raw: string, dirs: ErrorDirs) {
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return { path: path.resolve(raw), exists: existsSync(raw) }
  for (const base of [dirs.cwd, dirs.scriptDir, dirs.root]) {
    const p = path.resolve(base, raw)
    if (existsSync(p)) return { path: p, exists: true }
  }
  return { path: path.resolve(dirs.cwd, raw), exists: false }
}

/** 同一处报错在输出里常出现两遍（编译器一遍、脚本汇总一遍）：按 文件:行:内容 去重 */
export const errorKey = (e: LuaBuildError) => `${e.file}:${e.line}:${e.message}`
