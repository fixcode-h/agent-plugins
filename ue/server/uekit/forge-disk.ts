import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { readIni } from '../editor-tools/config-layers.ts'

/**
 * AssetForge 页的快速清单：配置根和配置根下的 JSON 直接从磁盘读，不经 UE。
 * 用户 2026-11-16：AssetForge 页左栏一直转圈——原来配置根和清单都要等 UE 回（编辑器没开时还要先拉起后台编辑器，
 * 一两分钟起步），可左栏本来只是列配置根下的 JSON。所以列表先从磁盘出，同步状态（待导入 / 被改过 / 出错）
 * 再由 UE 的 forge.entries 补上：状态要比内容哈希和资产文件修改时间，算法在 UE 里（FCrc::StrCrc32、FDateTime），
 * 面板不照抄，免得两边算得不一样把「已同步」标成「被改过」。
 * 规则对照 UEKit 的 AssetForgeSettings.cpp（配置根）、ForgeService.cpp 的 ScanConfigs / DescribeConfig
 * （跳过 `_` 开头的目录和文件、字段名）；返回字段和 UE 的同名操作一致，页面不用分两套。
 */

// 出错抛普通 Error：不 import instances.ts，单测不用拉上面板模块
const SECTION = '/Script/AssetForge.AssetForgeSettings'

const slash = (p: string) => p.replace(/\\/g, '/')
const isDir = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  )

/** 项目设置 → 插件 → Asset Forge → 配置根目录（config=Editor, defaultconfig：Config/DefaultEditor.ini，FDirectoryPath 写成 (Path="...")） */
export async function forgeRootFromSetting(root: string) {
  const ini = await readIni(path.join(root, 'Config', 'DefaultEditor.ini'))
  const raw =
    (ini?.get(SECTION) ?? [])
      .filter((e) => e.key === 'ConfigRoot')
      .map((e) => e.value)
      .at(-1)
      ?.trim() ?? ''
  const m = /Path\s*=\s*"([^"]*)"/.exec(raw)
  return (m ? m[1] : raw.replace(/^\(|\)$/g, '')).trim()
}

/** 配置根：设置了按设置（相对项目根，也接受绝对路径），没设置时项目外层有 ProjectDoc/docs 用 ProjectDoc/docs/AssetForge，否则 docs/AssetForge */
export async function forgeConfigRoot(root: string) {
  const set = await forgeRootFromSetting(root)
  if (set) return path.resolve(root, set)
  const sibling = path.resolve(root, '..', 'ProjectDoc', 'docs')
  return path.join((await isDir(sibling)) ? sibling : path.join(root, 'docs'), 'AssetForge')
}

/** 去掉 // 和 /* *\/ 注释（配置允许写注释），字符串里的不动 */
export function stripComments(text: string) {
  let out = ''
  let i = 0
  let str = false
  while (i < text.length) {
    const c = text[i]
    if (str) {
      out += c
      if (c === '\\' && i + 1 < text.length) out += text[++i]
      else if (c === '"') str = false
      i++
    } else if (c === '"') {
      str = true
      out += c
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return out
}

/** 和 UE 的 NormalizeAssetPath 一样：`/Script/Engine.Blueprint'/Game/A/B.B'` → `/Game/A/B`，`/Game/A/B.B_C` → `/Game/A/B` */
export function normalizeAsset(p: string) {
  let s = p.trim()
  const q = /'([^']*)'/.exec(s)
  if (q) s = q[1]
  return s.split(/[.:]/)[0]
}

/** 配置根下的 .json，跳过 `_` 开头的目录和文件（模板 `_templates/`、`_schema` 这类生成物，和 UE 的 IsGeneratedPath 一致） */
async function walk(dir: string, out: string[]) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('_')) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) await walk(abs, out)
    else if (e.isFile() && /\.json$/i.test(e.name)) out.push(abs)
  }
}

/** 并发读文件：几千份配置一次全开会撞上文件句柄上限 */
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export interface DiskEntry {
  key: string
  name: string
  /** 空 = 还不知道（等 UE 的 forge.entries 补）；JSON 本身坏了直接是 parse-error */
  state: string
  config: string
  configPath: string
  asset?: string
  kind?: string
  revision?: number
  message?: string
}

async function describe(rootAbs: string, abs: string): Promise<DiskEntry> {
  const config = slash(path.relative(rootAbs, abs))
  const base = { key: config, name: path.basename(abs, path.extname(abs)), config, configPath: slash(abs) }
  const text = await readFile(abs, 'utf8').catch(() => undefined)
  let doc: unknown
  try {
    doc = text === undefined ? undefined : JSON.parse(stripComments(text.replace(/^﻿/, '')))
  } catch (e) {
    return { ...base, state: 'parse-error', message: (e as Error).message }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return { ...base, state: 'parse-error', message: text === undefined ? '读不了文件' : '不是 JSON 对象' }
  const d = doc as Record<string, unknown>
  return {
    ...base,
    state: '',
    ...(typeof d.kind === 'string' && d.kind ? { kind: d.kind } : {}),
    ...(typeof d.asset === 'string' && d.asset.trim() ? { asset: normalizeAsset(d.asset) } : {}),
    ...(typeof d.revision === 'number' ? { revision: Math.trunc(d.revision) } : {}),
  }
}

/** forge.health 的磁盘版：只回页面用得上的配置根 */
async function health(root: string) {
  const rootAbs = await forgeConfigRoot(root)
  return { configRoot: slash(rootAbs), configRootExists: await isDir(rootAbs) }
}

/** forge.entries 的磁盘版：只列配置（不列没纳管的资产），state 留空等 UE 补；分页和 UE 一样 */
async function entries(root: string, args: Record<string, unknown>) {
  const rootAbs = await forgeConfigRoot(root)
  const files: string[] = []
  await walk(rootAbs, files)
  const all = await mapLimit(files, 32, (f) => describe(rootAbs, f))
  all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const offset = Math.max(0, Number(args.offset) || 0)
  const limit = Math.min(20000, Math.max(1, Number(args.limit) || 200))
  return { entries: all.slice(offset, offset + limit), total: all.length, offset }
}

/** 从磁盘回答的 AssetForge 操作：forge.health 在编辑器没开时、forge.entries 只在页面要快速清单（disk: true）时 */
export const FORGE_DISK_OPS = new Set(['forge.health', 'forge.entries'])

/** 返回里带 disk: true：页面据此知道同步状态还没到，Agent 也看得出这不是 UE 判的 */
export async function forgeFromDisk(root: string, op: string, args: Record<string, unknown>) {
  const res = op === 'forge.health' ? await health(root) : await entries(root, args)
  return { ...res, disk: true }
}
