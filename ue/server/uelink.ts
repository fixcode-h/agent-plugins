import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { cmpVersion } from './semver.ts'
import { c, readJson } from './util.ts'

export { cmpVersion }

/**
 * UE 端插件 UELink（公共库 fixcode-h/UELink，Agent 面板和 UEToVS 共用）的版本来源：插件包里自带的一份、公共库发布的最新正式版。
 * 安装约定见 UELink 仓库的 docs/protocol.md 第 5 节：三份里取最高版本、只升不降、下载要校验 sha256、清掉旧插件。
 */
export const UELINK = 'UELink'
/** 合进 UELink 的旧插件（目录名 = .uplugin 文件名）：装 UELink 时清掉 */
export const OLD_PLUGINS = ['AgentPanelBridge', 'UEToVSLink']
const DEFAULT_SOURCE = 'https://github.com/fixcode-h/UELink/releases/latest/download/manifest.json'

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
 * 更新源：插件参数 uelinkSource。空 = GitHub 最新正式版；http(s) 地址 = 镜像上的 manifest.json（或放着它的目录）；
 * 本机目录 = 里面放着 manifest.json 和源码包（公司内网、断网时用）
 */
function sourceSpec() {
  const s = String(c().config().uelinkSource ?? '').trim()
  if (!s) return { url: DEFAULT_SOURCE }
  if (/^https?:\/\//i.test(s)) return { url: s.endsWith('.json') ? s : `${s.replace(/\/+$/, '')}/manifest.json` }
  return { dir: s }
}

let cache: { at: number; result: { manifest?: UELinkManifest; base: string; error?: string } } | undefined
const CACHE_MS = 6 * 3600 * 1000

/** 读公共库的发布清单（6 小时内用缓存；refresh 时重读）。读不到不抛，error 里说原因 */
export async function remoteManifest(refresh = false) {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.result
  const spec = sourceSpec()
  let result: { manifest?: UELinkManifest; base: string; error?: string }
  try {
    if ('dir' in spec && spec.dir) {
      const manifest = await readJson<UELinkManifest | null>(path.join(spec.dir, 'manifest.json'), null)
      result = manifest ? { manifest, base: spec.dir } : { base: spec.dir, error: `${spec.dir} 里没有 manifest.json` }
    } else {
      const url = spec.url!
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      result = { manifest: (await res.json()) as UELinkManifest, base: url.slice(0, url.lastIndexOf('/')) }
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
 * 现在能装到的最新版本（自带的和公共库的取高的）：公共库只看缓存，缓存过期就在后台重读，
 * 下次刷新概况时就能看到公共库的新版本
 */
export async function availableVersion() {
  if (!cache || Date.now() - cache.at >= CACHE_MS) void remoteManifest().catch(() => undefined)
  const bundled = await bundledVersion()
  const remote = cachedRemoteVersion()
  return remote && cmpVersion(remote, bundled) > 0 ? remote : bundled
}

/** 自带的和公共库的哪个新就用哪个；公共库读不到时用自带的，原因放在 remoteError 里 */
export async function bestSource(refresh = false): Promise<{ source: UELinkSource; remoteError?: string }> {
  const bundled: UELinkSource = { kind: 'bundled', version: await bundledVersion(), dir: bundledDir() }
  const remote = await remoteManifest(refresh)
  if (!remote.manifest) return { source: bundled, remoteError: remote.error }
  if (cmpVersion(remote.manifest.version, bundled.version) > 0)
    return { source: { kind: 'remote', version: remote.manifest.version, manifest: remote.manifest, base: remote.base } }
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
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error(`下载 ${url} 失败：HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  }
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== manifest.sha256) throw new Error(`UELink ${manifest.version} 的源码包校验不对（sha256 ${sha}，清单里是 ${manifest.sha256}）`)
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
