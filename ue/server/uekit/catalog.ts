import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { bridgeVersionIn } from '../instances.ts'
import { cmpVersion } from '../semver.ts'
import type { UeProject } from '../types.ts'
import { findPluginDirs, pluginVersion, UELINK, type UELinkManifest } from '../uelink.ts'
import { c, readJson } from '../util.ts'
import { netGet } from './net.ts'
import { kitInfo, type KitFields, type KitInfo } from './kit-info.ts'
import { engineTooOld, pickOffer } from './offer.ts'

/**
 * UEKit 插件库（fixcode-h/UEKit）里 UELink 的扩展插件（AssetForge、GameTest）：查插件目录 catalog.json、
 * 看项目里装了哪个版本、能不能装（引擎版本、UELink 版本）。安装约定见 UEKit 仓库 docs/protocol.md 第 4–6 节。
 * UELink 自己仍走 uelink.ts（自带一份，和 UEToVS 共用的安装约定），这里只管扩展。
 */
export const DEFAULT_CATALOG = 'https://raw.githubusercontent.com/fixcode-h/UEKit/main/catalog.json'

/** 面板认得的扩展：有专门的页面和工具。目录里别的扩展照样列出、能装，只是没有页面 */
export const KNOWN_EXTENSIONS = ['AssetForge', 'GameTest'] as const

export interface KitManifest extends UELinkManifest, KitFields {
  displayName?: string
  description?: string
  kind?: 'base' | 'extension'
}

export interface CatalogEntry {
  name: string
  displayName?: string
  description?: string
  kind?: 'base' | 'extension'
  latest: KitManifest | null
  prerelease: KitManifest | null
}

interface CatalogResult {
  plugins: CatalogEntry[]
  /** 源码包的位置：http(s) 地址的目录或本机目录；GitHub 上按清单里的 url 下载 */
  base: string
  error?: string
  /** cacheOnly 且这次运行里还没读过：没去 GitHub，等用户点「检查更新」 */
  unchecked?: boolean
  /** 读的时间（毫秒时间戳），UE 插件页状态条显示「几分钟前检查」 */
  at?: number
  /** 从哪读的：GitHub、镜像地址或本机目录 */
  source?: string
}

/**
 * 更新源：插件参数 uekitSource。空 = GitHub 上 UEKit 的 main 分支；http(s) 地址 = 镜像上的 catalog.json（或放着它的目录）；
 * 本机目录 = 里面放着 catalog.json 和各插件的源码包（公司内网、断网时用）
 */
function sourceSpec() {
  const s = String(c().config().uekitSource ?? '').trim()
  if (!s) return { url: DEFAULT_CATALOG }
  if (/^https?:\/\//i.test(s)) return { url: s.endsWith('.json') ? s : `${s.replace(/\/+$/, '')}/catalog.json` }
  return { dir: s }
}

let cache: { at: number; result: CatalogResult } | undefined

/**
 * 读插件目录：有缓存就用缓存（不管多旧），refresh 时重读。读不到不抛，error 里说原因。
 * cacheOnly（打开页面时）没有缓存也不去网上读，返回 unchecked：拉 GitHub 只能由用户手动触发（用户定的长期规则）；
 * 本机目录不走网络，照常读
 */
export async function readCatalog(refresh = false, cacheOnly = false): Promise<CatalogResult> {
  if (!refresh && cache) return cache.result
  const spec = sourceSpec()
  if (!refresh && cacheOnly && !spec.dir) return { plugins: [], base: '', unchecked: true }
  let result: CatalogResult
  try {
    if (spec.dir) {
      const doc = await readJson<{ plugins?: CatalogEntry[] } | null>(path.join(spec.dir, 'catalog.json'), null)
      result = doc
        ? { plugins: doc.plugins ?? [], base: spec.dir }
        : { plugins: [], base: spec.dir, error: `${spec.dir} 里没有 catalog.json` }
    } else {
      const url = spec.url!
      const doc = JSON.parse((await netGet(url)).toString('utf8')) as { plugins?: CatalogEntry[] }
      // GitHub 上的 catalog.json 和源码包不在同一处：按清单里的 url 下载（base 留空）
      result = { plugins: doc.plugins ?? [], base: url === DEFAULT_CATALOG ? '' : url.slice(0, url.lastIndexOf('/')) }
    }
  } catch (e) {
    result = { plugins: [], base: '', error: (e as Error).message }
  }
  result.at = Date.now()
  result.source = spec.dir ?? (spec.url === DEFAULT_CATALOG ? 'fixcode-h/UEKit' : spec.url)
  cache = { at: result.at, result }
  return result
}

/** 项目里装着的插件：目录（相对项目根）和 .uplugin 里的版本，没装为 undefined */
export async function installedIn(root: string, name: string) {
  const dirs = await findPluginDirs(root, name)
  if (!dirs.length) return undefined
  const version = await pluginVersion(path.join(dirs[0], `${name}.uplugin`))
  const record = await readFile(path.join(dirs[0], '.install.json'), 'utf8')
    .then((s) => JSON.parse(s) as { mode?: string })
    .catch(() => undefined)
  return { dir: dirs[0], rel: path.relative(root, dirs[0]), version, mode: record?.mode }
}

/** requires 里的 ">=2.2.0-beta.1"：只支持 >=（UEKit 的 kit.json 只这么写） */
export function satisfies(installed: string, range: string) {
  const m = /^>=\s*(\S+)$/.exec(range.trim())
  if (!m) return true
  return !!installed && installed !== '?' && cmpVersion(installed, m[1]) >= 0
}

/** 这一版装进这个项目前要先解决的问题（引擎太旧、UELink 没装或太旧）；没有问题返回空数组 */
export async function blockers(project: UeProject, m: KitManifest) {
  const out: string[] = []
  if (engineTooOld(project, m.engineMin))
    out.push(c().t('要 UE {min} 或更新，这个项目是 {v}', { min: m.engineMin ?? '', v: project.engine.version }))
  const need = m.requires?.[UELINK]
  if (need) {
    const have = await bridgeVersionIn(project.root)
    if (!satisfies(have, need))
      out.push(
        have
          ? c().t('要 UELink {need}，项目里是 {have}：先在上面升级 UELink', { need, have })
          : c().t('要先装 UELink（{need}）：在上面安装', { need }),
      )
  }
  return out
}

export interface ExtensionStatus {
  name: string
  displayName: string
  description: string
  known: boolean
  installed?: { version: string; rel: string; mode?: string }
  latest?: string
  prerelease?: string
  /** 能装的那一版（见 pickOffer） */
  offer?: { version: string; prerelease: boolean; blockers: string[]; notes?: string; uelink?: string }
  /** 开着的 UE 进程里实际加载的版本（装了新版没重编时和磁盘上的不同） */
  loaded?: string
  /** 卡片上的实测引擎、依赖、可选插件、工具（取能装的那一版，没有时取最新版） */
  info?: KitInfo
}

/** UE 插件页 UELink 卡片要的目录信息（安装、版本仍看 state.bridge / bundled） */
export interface UELinkCatalog {
  description?: string
  latest?: string
  prerelease?: string
  info?: KitInfo
}

/** UE 插件页用：目录里的每个扩展 + 项目里装着、目录里没有的（旧镜像、手动放的） */
export async function extensionStatus(
  project: UeProject,
  loaded: Map<string, string>,
  refresh = false,
): Promise<{
  items: ExtensionStatus[]
  error?: string
  unchecked?: boolean
  uelinkPreUpdate?: string
  uelink?: UELinkCatalog
  checkedAt?: number
  source?: string
}> {
  // 打开页面只看缓存，点「检查更新」才去 GitHub（同时重读 UELink 的发布清单，见 api-ext.ts）
  const cat = await readCatalog(refresh, true)
  const entries = cat.plugins.filter((e) => e.kind !== 'base' && e.name !== UELINK)
  // 扩展要的 UELink 只有预发布版时，UE 插件页给「升级到预发布」（正式版、自带的都不够新才用它）
  const base = cat.plugins.find((e) => e.name === UELINK)
  const pre = base?.prerelease?.version
  const have = await bridgeVersionIn(project.root)
  const names = [...new Set([...KNOWN_EXTENSIONS, ...entries.map((e) => e.name)])]
  const items = await Promise.all(
    names.map(async (name): Promise<ExtensionStatus> => {
      const e = entries.find((x) => x.name === name)
      const inst = await installedIn(project.root, name)
      const offerM = e ? pickOffer(project, e, inst?.version) : null
      return {
        name,
        displayName: e?.displayName || name,
        description: e?.description || '',
        known: (KNOWN_EXTENSIONS as readonly string[]).includes(name),
        installed: inst && { version: inst.version, rel: inst.rel, mode: inst.mode },
        latest: e?.latest?.version,
        prerelease: e?.prerelease?.version,
        offer: offerM
          ? {
              version: offerM.version,
              prerelease: /-/.test(offerM.version),
              blockers: await blockers(project, offerM),
              notes: offerM.notes,
              uelink:
                pre &&
                offerM.requires?.[UELINK] &&
                !satisfies(have, offerM.requires[UELINK]) &&
                satisfies(pre, offerM.requires[UELINK])
                  ? pre
                  : undefined,
            }
          : undefined,
        loaded: loaded.get(name),
        info: await kitInfo(project, offerM ?? e?.latest ?? e?.prerelease),
      }
    }),
  )
  // 项目里装的已经是 UELink 预发布版（为装扩展升上去的）时，继续给更新的预发布版：
  // 查更新只认正式版，否则修了编译错误的新预发布永远到不了用户手上（5.4 上实际碰到过）
  const uelinkPreUpdate = pre && /-/.test(have) && cmpVersion(pre, have) > 0 ? pre : undefined
  const uelink: UELinkCatalog | undefined = base && {
    description: base.description || base.latest?.description || base.prerelease?.description,
    latest: base.latest?.version,
    prerelease: base.prerelease?.version,
    info: await kitInfo(project, base.latest ?? base.prerelease),
  }
  return {
    items,
    error: cat.error,
    unchecked: cat.unchecked,
    uelinkPreUpdate,
    uelink,
    checkedAt: cat.at,
    source: cat.source,
  }
}

/** 按名字和版本取清单（安装用） */
export async function manifestFor(name: string, version?: string) {
  const cat = await readCatalog(true)
  const e = cat.plugins.find((x) => x.name === name)
  if (!e) throw new Error(cat.error || c().t('插件目录里没有 {name}', { name }))
  const all = [e.latest, e.prerelease].filter((m): m is KitManifest => !!m)
  const m = version ? all.find((x) => x.version === version) : (e.latest ?? e.prerelease)
  if (!m) throw new Error(c().t('插件目录里没有 {name} {v}', { name, v: version ?? '' }))
  return { manifest: m, base: cat.base }
}
