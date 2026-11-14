/**
 * 代码类枚举扫描要读哪些文件：按规则的通配（相对项目目录，也可以是绝对路径；逗号分隔，** 跨目录）在磁盘上找，
 * 只走通配里写死的那段目录（Source/**\/*.h 只走 Source），跳过 .git、node_modules、UE 的 Intermediate / Binaries 这类大目录。
 * 超过上限直接报错让用户收窄通配，不悄悄截断（截断了扫出的枚举会少一块，用户看不出来）。
 */
import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import { splitGlobs } from '../../shared/table-enum-scan.ts'

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

/** 通配 → 正则（按 / 分段：** 跨目录，* ? 不跨，{a,b} 任选一个） */
export function globRe(glob: string) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const e = glob.indexOf('}', i)
      if (e < 0) re += '\\{'
      else {
        re += `(?:${glob
          .slice(i + 1, e)
          .split(',')
          .map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&'))
          .join('|')})`
        i = e
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '')
}

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
    if (ok) await walk(root)
  }
  return [...out.values()].sort((a, b) => a.rel.localeCompare(b.rel))
}

/** 要盯着的目录（watch）：每个通配写死的那段目录 */
export function watchRoots(dir: string, globs: string[]) {
  return [...new Set(globs.map((g) => (isAbs(g) ? path.resolve(globBase(g) || '/') : path.join(dir, globBase(g)))))]
}
