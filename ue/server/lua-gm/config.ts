import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { docsRoot, legacyDocsRoot } from '../doc-root.ts'
import type { UeProject } from '../types.ts'
import { readJson, writeJson } from '../util.ts'
import type { LuaGmBinding, LuaGmConfig } from './types.ts'

type P = Pick<UeProject, 'id' | 'root' | 'favStore'>

/**
 * 存放位置和资源页收藏一样（用户 2026-11-16：扫描脚本存到和收藏夹同一个存储位置设置下）：
 * 项目文档根的 AgentPanel/UE 或项目的 .agent-panel/ue，可以提交、团队共用。
 * 文档根用面板算好的（doc-root.ts）：P4 / SVN 项目是各分支共用的那份 ProjectDoc/docs，扫描脚本写一次，
 * 换分支、换电脑都直接复用，不再提示「还没设置」（用户 2026-11-20）
 */
export const storeDir = (p: P) =>
  p.favStore === 'project' ? path.join(p.root, '.agent-panel', 'ue') : path.join(docsRoot(p), 'AgentPanel', 'UE')

/**
 * 读的时候还看哪些位置（按顺序）：换了存放位置后脚本和设置还在另一个位置；升级前插件按旧规则猜的文档根
 * （.uproject 上一级的 ProjectDoc/docs 或项目里的 docs）。都照样读得到，写进当前位置
 */
const oldDirs = (p: P) => [
  storeDir({ ...p, favStore: p.favStore === 'project' ? 'docs' : 'project' }),
  path.join(legacyDocsRoot(p.root), 'AgentPanel', 'UE'),
]

export const SCRIPT_NAME = 'lua-gm-scan.mjs'
const CONFIG_NAME = 'lua-gm.json'

/** 读用的位置：当前位置没有、旧位置有就用旧位置 */
function located(p: P, name: string) {
  const cur = path.join(storeDir(p), name)
  if (existsSync(cur)) return cur
  return (
    oldDirs(p)
      .map((d) => path.join(d, name))
      .find((f) => existsSync(f)) ?? cur
  )
}

/**
 * 升级前按旧规则存的脚本和设置（例如分支自己目录下的 ProjectDoc/docs）复制一份到面板的文档根：
 * 各分支共用的那份有了，别的分支打开 GM 页直接复用，不用再让 AI 写一遍。旧文件不删（可能已经提交进版本管理）
 */
export async function adoptOld(p: P) {
  if (p.favStore === 'project') return
  const dir = storeDir(p)
  const old = path.join(legacyDocsRoot(p.root), 'AgentPanel', 'UE')
  if (path.resolve(old) === path.resolve(dir)) return
  for (const name of [SCRIPT_NAME, CONFIG_NAME]) {
    const from = path.join(old, name)
    const to = path.join(dir, name)
    if (existsSync(to) || !existsSync(from)) continue
    await mkdir(dir, { recursive: true })
    await copyFile(from, to)
  }
}

export const scriptFile = (p: P) => located(p, SCRIPT_NAME)
export const configFile = (p: P) => located(p, CONFIG_NAME)

const EMPTY: LuaGmConfig = { files: [], bindings: {} }

export async function readConfig(p: P): Promise<LuaGmConfig> {
  const raw = await readJson<Partial<LuaGmConfig>>(configFile(p), {})
  return {
    files: Array.isArray(raw.files) ? raw.files.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [],
    bindings: raw.bindings && typeof raw.bindings === 'object' ? raw.bindings : {},
  }
}

/** 改设置：files 整份换；bindings 按键合并（团队共用的文件，别人刚改的其它关联不被盖掉），值 undefined 表示删掉这条改动 */
export async function patchConfig(
  p: P,
  b: { files?: unknown; binding?: { key?: unknown; value?: LuaGmBinding | null } },
): Promise<LuaGmConfig> {
  const cur = { ...EMPTY, ...(await readConfig(p)) }
  if (Array.isArray(b.files))
    cur.files = [
      ...new Set(
        b.files
          .map((x) =>
            String(x ?? '')
              .trim()
              .replaceAll('\\', '/'),
          )
          // 项目外的全局路径（G:/Shared/GM/*.lua、/opt/shared/*.lua）也行：GM 文件可能放在几个项目共用的目录里（用户 2026-11-16）；
          // .. 不认，要项目外的就直接写绝对路径，看得清读的是哪里
          .filter((x) => x && !x.split('/').includes('..')),
      ),
    ].slice(0, 50)
  if (b.binding && typeof b.binding.key === 'string') {
    const bindings = { ...cur.bindings }
    if (b.binding.value === undefined) delete bindings[b.binding.key]
    else bindings[b.binding.key] = cleanBinding(b.binding.value)
    cur.bindings = bindings
  }
  await writeJson(path.join(storeDir(p), CONFIG_NAME), cur)
  return cur
}

/** 辅助描述列最多几列：再多下拉一行放不下 */
export const MAX_EXTRA = 6

export function cleanBinding(v: LuaGmBinding | null): LuaGmBinding | null {
  if (!v || !String(v.table ?? '').trim() || !String(v.key ?? '').trim()) return null
  const extra = Array.isArray(v.extra) ? v.extra.map(String).filter(Boolean).slice(0, MAX_EXTRA) : []
  return {
    table: String(v.table).trim(),
    ...(v.sheet?.trim() ? { sheet: v.sheet.trim() } : {}),
    key: String(v.key).trim(),
    ...(v.label?.trim() ? { label: v.label.trim() } : {}),
    ...(extra.length ? { extra } : {}),
  }
}

/** 一个文件最多读多大、最多扫多少个：GM 文件是手写的脚本，超出多半是写错了模式（把整个 Content 扫进来） */
export const MAX_FILES = 500
const MAX_WALK = 20000
const SKIP = new Set(['.git', 'node_modules', 'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache'])

/** 模式的固定开头（没有通配符的那几段）和剩下部分的正则 */
export function splitPattern(pattern: string) {
  const norm = pattern.replaceAll('\\', '/').replace(/^\.\//, '')
  // 绝对路径的开头（/、// 网络路径）split 后会丢，单独留着；G:/ 这种盘符本身就是第一段
  const lead = /^\/\//.test(norm) ? '//' : norm.startsWith('/') ? '/' : ''
  const segs = norm.split('/').filter(Boolean)
  const i = segs.findIndex((s) => /[*?[{]/.test(s))
  if (i < 0) return { base: lead + segs.join('/'), re: undefined, deep: false }
  const rest = segs.slice(i).join('/')
  let re = ''
  for (let k = 0; k < rest.length; k++) {
    const ch = rest[k]
    if (ch === '*' && rest[k + 1] === '*') {
      // **/ 匹配零层或多层目录
      if (rest[k + 2] === '/') {
        re += '(?:.*/)?'
        k += 2
      } else {
        re += '.*'
        k++
      }
    } else if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return {
    base: lead + segs.slice(0, i).join('/'),
    re: new RegExp(`^${re}$`, 'i'),
    deep: rest.includes('**') || i < segs.length - 1,
  }
}

/** 扫描结果里的文件路径换回磁盘上的位置：项目里的是相对项目根，项目外的本来就是绝对路径 */
export const fileAbs = (root: string, f: string) => path.resolve(root, f)

/**
 * 按模式列出 GM 文件和走过的目录（盯文件变化用）。项目里的文件给相对项目根的路径，项目外的（全局路径）给绝对路径，
 * 都用 / 分隔。自己走目录不用 fs.glob：Node 22 上它还是实验接口，会打警告
 */
export async function matchFiles(root: string, patterns: string[]) {
  const files = new Set<string>()
  const dirs = new Set<string>()
  // G: 这种只有盘符的开头要补 /，不然 Windows 上会解析成那个盘的当前目录
  const absOf = (b: string) => path.resolve(root, /^[A-Za-z]:$/.test(b) ? `${b}/` : b)
  const out = (a: string) => {
    const r = path.relative(root, a)
    return (r && !r.startsWith('..') && !path.isAbsolute(r) ? r : a).replaceAll('\\', '/')
  }
  let walked = 0
  for (const pat of patterns) {
    const { base, re, deep } = splitPattern(pat)
    const baseAbs = absOf(base)
    if (!re) {
      if (existsSync(baseAbs)) {
        files.add(out(baseAbs))
        dirs.add(path.dirname(baseAbs))
      }
      continue
    }
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (walked++ > MAX_WALK || files.size >= MAX_FILES) return
      const abs = path.join(baseAbs, rel)
      dirs.add(abs)
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (deep && !SKIP.has(e.name) && depth < 12) await walk(r, depth + 1)
        } else if (re.test(r)) files.add(out(path.join(baseAbs, r)))
      }
    }
    await walk('', 0)
  }
  return { files: [...files].sort().slice(0, MAX_FILES), dirs: [...dirs] }
}
