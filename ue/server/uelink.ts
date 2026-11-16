import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { cmpVersion } from './semver.ts'
import { readCatalog } from './uekit/catalog.ts'
import { netGet } from './uekit/net.ts'
import { c, readJson } from './util.ts'

export { cmpVersion }

/**
 * UE 端插件 UELink（UEKit 插件库 fixcode-h/UEKit 里的基础插件）的版本来源：插件包里自带的一份、插件库发布的最新正式版。
 * 安装约定见 UEKit 仓库的 docs/protocol.md 第 4、5 节：三份里取最高版本、只升不降、下载要校验 sha256、清掉旧插件。
 * 原来的 fixcode-h/UELink 仓库已经删掉，2.2 起版本从 UEKit 的插件目录 catalog.json 里取（UELink 那条的 latest）。
 */
export const UELINK = 'UELink'
/** 合进 UELink 的旧插件（目录名 = .uplugin 文件名）：装 UELink 时清掉 */
export const OLD_PLUGINS = ['AgentPanelBridge', 'UEToVSLink']

export interface UELinkManifest {
  name: string
  version: string
  versionCode?: number
  protocol?: number
  engineMin?: string
  asset: string
  url: string
  sha256: string
  replaces?: string[]
  notes?: string
}

/** 一份可装的 UELink：bundled 是插件包里的源码目录，remote 要先下载 */
export type UELinkSource =
  | { kind: 'bundled'; version: string; dir: string }
  | { kind: 'remote'; version: string; manifest: UELinkManifest; base: string }

export const bundledDir = () => path.join(c().dir, 'bridge', UELINK)

export async function bundledVersion() {
  return pluginVersion(path.join(bundledDir(), `${UELINK}.uplugin`))
}

export async function pluginVersion(uplugin: string) {
  const txt = await readFile(uplugin, 'utf8').catch(() => '')
  if (!txt) return ''
  try {
    return String(JSON.parse(txt.replace(/^﻿/, '')).VersionName ?? '?')
  } catch {
    return '?'
  }
}

/**
 * 更新源：插件参数 uelinkSource。空 = UEKit 插件目录里 UELink 的最新正式版（跟着「UEKit 插件目录」走）；http(s) 地址 = 镜像上的 manifest.json（或放着它的目录）；
 * 本机目录 = 里面放着 manifest.json 和源码包（公司内网、断网时用）
 */
function sourceSpec() {
  const s = String(c().config().uelinkSource ?? '').trim()
  if (!s) return { catalog: true as const }
  if (/^https?:\/\//i.test(s)) return { url: s.endsWith('.json') ? s : `${s.replace(/\/+$/, '')}/manifest.json` }
  return { dir: s }
}

let cache: { at: number; result: { manifest?: UELinkManifest; base: string; error?: string } } | undefined

/**
 * 读公共库的发布清单（有缓存就用，refresh 时重读）。读不到不抛，error 里说原因。
 * 只在用户手动操作时调（「检查更新」、安装 / 升级）：拉 GitHub 不自动做（用户定的长期规则）
 */
export async function remoteManifest(refresh = false) {
  if (!refresh && cache) return cache.result
  const spec = sourceSpec()
  let result: { manifest?: UELinkManifest; base: string; error?: string }
  try {
    if ('catalog' in spec) {
      // 只认正式版（protocol.md 第 4 节）：预发布的 C++ 还没在本地编译验证过，不推给用户
      const cat = await readCatalog(refresh)
      if (cat.error) throw new Error(cat.error)
      const entry = cat.plugins.find((x) => x.name === UELINK)
      result = { manifest: entry?.latest ?? undefined, base: cat.base }
    } else if ('dir' in spec && spec.dir) {
      const manifest = await readJson<UELinkManifest | null>(path.join(spec.dir, 'manifest.json'), null)
      result = manifest ? { manifest, base: spec.dir } : { base: spec.dir, error: `${spec.dir} 里没有 manifest.json` }
    } else {
      const url = spec.url!
      const manifest = JSON.parse((await netGet(url)).toString('utf8')) as UELinkManifest
      result = { manifest, base: url.slice(0, url.lastIndexOf('/')) }
    }
    if (result.manifest && (!result.manifest.version || !result.manifest.sha256))
      result = { base: result.base, error: 'manifest.json 缺 version 或 sha256' }
  } catch (e) {
    result = { base: '', error: (e as Error).message }
  }
  cache = { at: Date.now(), result }
  return result
}

/** 只看缓存，不发请求：概况页要快，查更新在后台做 */
export function cachedRemoteVersion() {
  return cache?.result.manifest?.version ?? ''
}

/**
 * 现在能装到的最新版本（自带的和公共库的取高的）：公共库只看缓存，不在后台去 GitHub 重读，
 * 用户在「UE 插件」页点「检查更新」后才看得到公共库的新版本
 */
export async function availableVersion() {
  const bundled = await bundledVersion()
  const remote = cachedRemoteVersion()
  return remote && cmpVersion(remote, bundled) > 0 ? remote : bundled
}

/**
 * UEKit 插件目录里 UELink 的预发布版（没有为 undefined）。只在用户为了装要新 UELink 的扩展、
 * 在「UE 插件」页明确点了「升级 UELink（预发布）」时用；查更新、普通安装仍只认正式版
 */
export async function uelinkPrerelease(refresh = false) {
  const cat = await readCatalog(refresh)
  const m = cat.plugins.find((x) => x.name === UELINK)?.prerelease
  return m ? { manifest: m, base: cat.base } : undefined
}

/**
 * 自带的和公共库的哪个新就用哪个；公共库读不到时用自带的，原因放在 remoteError 里。
 * prerelease 给了版本号时装 UEKit 目录里这一版预发布（见 uelinkPrerelease）
 */
export async function bestSource(
  refresh = false,
  prerelease = '',
): Promise<{ source: UELinkSource; remoteError?: string }> {
  if (prerelease) {
    const pre = await uelinkPrerelease(true)
    if (!pre || pre.manifest.version !== prerelease)
      throw new Error(c().t('UEKit 插件目录里没有 UELink {v} 预发布版', { v: prerelease }))
    return { source: { kind: 'remote', version: prerelease, manifest: pre.manifest, base: pre.base } }
  }
  const bundled: UELinkSource = { kind: 'bundled', version: await bundledVersion(), dir: bundledDir() }
  const remote = await remoteManifest(refresh)
  if (!remote.manifest) return { source: bundled, remoteError: remote.error }
  if (cmpVersion(remote.manifest.version, bundled.version) > 0)
    return {
      source: { kind: 'remote', version: remote.manifest.version, manifest: remote.manifest, base: remote.base },
    }
  return { source: bundled }
}

/** 下载源码包并校验 sha256：镜像目录里按 asset 文件名找，GitHub 上按清单里的 url，镜像地址按 base + asset */
export async function downloadZip(src: Extract<UELinkSource, { kind: 'remote' }>) {
  const { manifest, base } = src
  let buf: Buffer
  if (base && !/^https?:\/\//i.test(base)) {
    buf = await readFile(path.join(base, manifest.asset))
  } else {
    const url = base && !base.includes('github.com') ? `${base}/${manifest.asset}` : manifest.url
    buf = await netGet(url)
  }
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== manifest.sha256)
    throw new Error(`UELink ${manifest.version} 的源码包校验不对（sha256 ${sha}，清单里是 ${manifest.sha256}）`)
  return buf
}

/** 项目 Plugins/ 下（含一层分组目录）找某个插件的目录 */
export async function findPluginDirs(root: string, name: string) {
  const plugins = path.join(root, 'Plugins')
  const out: string[] = []
  const walk = async (dir: string, depth: number) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    if (entries.some((e) => e.isFile() && e.name === `${name}.uplugin`)) {
      out.push(dir)
      return
    }
    if (depth >= 2) return
    for (const e of entries)
      if (e.isDirectory() && !/^(\.|Binaries$|Intermediate$|Source$|Content$|Resources$|Config$)/.test(e.name))
        await walk(path.join(dir, e.name), depth + 1)
  }
  await walk(plugins, 0)
  return out
}
