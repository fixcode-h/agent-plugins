/**
 * 代码类枚举扫描要读哪些文件：按规则的通配（相对项目目录，也可以是绝对路径；逗号分隔，** 跨目录）在磁盘上找，
 * 只走通配里写死的那段目录（Source/**\/*.h 只走 Source），跳过 .git、node_modules、UE 的 Intermediate / Binaries 这类大目录。
 * 超过上限直接报错让用户收窄通配，不悄悄截断（截断了扫出的枚举会少一块，用户看不出来）。
 */
import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import { indexedFiles } from './file-index.ts'
import { extsOfGlob } from '../file-index/indexed.ts'
import { pathGlobRe, splitGlobs } from '../../shared/table-enum-scan.ts'

/** 一条规则最多读这么多个文件、这么大 */
export const MAX_FILES = 5000
export const MAX_BYTES = 50 * 1024 * 1024
/** 这些目录不进去：版本库、依赖、UE 的中间产物 */
export const SKIP_DIRS = new Set([
  '.git',
  '.svn',
  '.vs',
  '.idea',
  'node_modules',
  'Intermediate',
  'Binaries',
  'DerivedDataCache',
  'Saved',
])

export interface SrcFile {
  /** 显示和记录用：项目里的写相对路径，项目外的写绝对路径 */
  rel: string
  full: string
  mtime: string
  size: number
}

/** 通配 → 正则（写法在 shared 的 pathGlobRe）：Windows 上不分大小写 */
export const globRe = (glob: string) => pathGlobRe(glob, process.platform === 'win32')

/** 通配里不带通配符的开头那段目录：只从这里往下走 */
export function globBase(glob: string) {
  const segs = glob.split('/')
  const out: string[] = []
  for (const s of segs.slice(0, -1)) {
    if (/[*?{]/.test(s)) break
    out.push(s)
  }
  return out.join('/')
}

const isAbs = (p: string) => path.isAbsolute(p) || /^[A-Za-z]:\//.test(p)
const norm = (p: string) => p.replace(/\\/g, '/')

/** 按通配找文件；exclude 也是通配（按相对路径或文件名比） */
export async function findSources(dir: string, files: string, exclude: string): Promise<SrcFile[]> {
  const globs = splitGlobs(files)
  if (!globs.length) throw new Error(t('还没填要扫哪些文件'))
  const excl = splitGlobs(exclude).map(globRe)
  const out = new Map<string, SrcFile>()
  let bytes = 0
  for (const g of globs) {
    const abs = isAbs(g)
    const re = globRe(g)
    const base = globBase(g)
    const root = abs ? path.resolve(base || '/') : path.join(dir, base)
    const relOf = (full: string) => (abs ? norm(full) : norm(path.relative(dir, full)))
    const walk = async (d: string): Promise<void> => {
      const ents = await readdir(d, { withFileTypes: true }).catch(() => [])
      for (const e of ents) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full)
          continue
        }
        if (!e.isFile()) continue
        const rel = relOf(full)
        if (!re.test(rel) || out.has(full)) continue
        if (excl.some((x) => x.test(rel) || x.test(e.name))) continue
        const st = await stat(full).catch(() => null)
        if (!st) continue
        bytes += st.size
        if (out.size >= MAX_FILES || bytes > MAX_BYTES)
          throw new Error(
            t('「{glob}」对上的文件太多（超过 {n} 个或 {mb} MB），把通配写窄一点，比如只指到放枚举的目录', {
              glob: g,
              n: MAX_FILES,
              mb: MAX_BYTES / 1024 / 1024,
            }),
          )
        out.set(full, { rel, full, mtime: st.mtime.toISOString(), size: st.size })
      }
    }
    const ok = await stat(root)
      .then((s) => s.isDirectory())
      .catch(() => false)
    // 面板有项目文件索引时直接取这棵目录的文件，再按通配、排除和上限筛（只 stat 对上的）
    // 通配最后一段看得出扩展名（*.h）就只要那几种：源码大目录整棵拿出来很占内存
    const listed = ok ? await indexedFiles(root, extsOfGlob(g)) : undefined
    if (listed) {
      for (const r of listed) {
        const segs = r.split('/')
        if (segs.slice(0, -1).some((s) => SKIP_DIRS.has(s) || s.startsWith('.'))) continue
        const full = path.join(root, ...segs)
        const rel = relOf(full)
        if (!re.test(rel) || out.has(full)) continue
        if (excl.some((x) => x.test(rel) || x.test(segs[segs.length - 1]))) continue
        const st = await stat(full).catch(() => null)
        if (!st) continue
        bytes += st.size
        if (out.size >= MAX_FILES || bytes > MAX_BYTES)
          throw new Error(
            t('「{glob}」对上的文件太多（超过 {n} 个或 {mb} MB），把通配写窄一点，比如只指到放枚举的目录', {
              glob: g,
              n: MAX_FILES,
              mb: MAX_BYTES / 1024 / 1024,
            }),
          )
        out.set(full, { rel, full, mtime: st.mtime.toISOString(), size: st.size })
      }
    } else if (ok) await walk(root)
  }
  return [...out.values()].sort((a, b) => a.rel.localeCompare(b.rel))
}

/** 要盯着的目录（watch）：每个通配写死的那段目录 */
export function watchRoots(dir: string, globs: string[]) {
  return [...new Set(globs.map((g) => (isAbs(g) ? path.resolve(globBase(g) || '/') : path.join(dir, globBase(g)))))]
}
