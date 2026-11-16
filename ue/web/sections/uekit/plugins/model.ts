import type { Job, ProjectState, UeProject } from '../../../../server/types.ts'
import type { ExtensionStatus, UELinkCatalog } from '../../../../server/uekit/catalog.ts'
import type { KitInfo } from '../../../../server/uekit/kit-info.ts'
import { canUpgrade, cmpVersion } from '../../../../server/semver.ts'

/**
 * UE 插件页的卡片数据：UELink（state 里的 bridge / bundled）和扩展（GET ext）合成同一个结构，
 * 卡片、「要处理」、「全部升级」都从这里取（设计稿 designs/UE插件管理页重设计-设计稿.md）。
 */
export interface ExtList {
  items: ExtensionStatus[]
  error?: string
  unchecked?: boolean
  uelinkPreUpdate?: string
  uelink?: UELinkCatalog
  checkedAt?: number
  source?: string
}

export interface PluginView {
  name: string
  displayName: string
  description: string
  /** UELink：别的插件都挂在它上面 */
  base: boolean
  /** 面板有专门页面的扩展（能「打开」） */
  known: boolean
  installed?: { version: string; rel: string; mode?: string }
  /** 能装 / 升到的那一版；pre：UELink 走 UEKit 目录里的预发布 */
  offer?: { version: string; prerelease: boolean; blockers: string[]; notes?: string; pre?: string }
  /** 装着的比能装的旧 */
  upgrade: boolean
  /** 编辑器里加载的版本，编辑器没开或旧 UELink 不报时为空 */
  loaded?: string
  info?: KitInfo
  /** 装着的、依赖它的插件（只有 UELink 有） */
  requiredBy: string[]
  /** 装着旧版桥接 AgentPanelBridge（UELink 升级会换掉它） */
  legacy?: boolean
  /** 扩展要的 UELink 不满足、但 UELink 卡片有能满足的版本：安装时一起升级 UELink */
  withUELink?: boolean
}

/** requires 里的 ">=x"：和服务端 catalog.ts 的 satisfies 一样（那边引了 node 模块，网页不能直接用） */
export function satisfies(installed: string | undefined, range: string) {
  const m = /^>=\s*(\S+)$/.exec(range.trim())
  if (!m) return true
  return !!installed && installed !== '?' && cmpVersion(installed, m[1]) >= 0
}

const editorOf = (s?: ProjectState) => s?.instances.find((i) => i.kind === 'editor' && i.online)

export function uelinkView(project: UeProject, s: ProjectState | undefined, ext: ExtList | undefined): PluginView {
  const installed = s?.bridge || ''
  // 扩展要的 UELink 只有预发布版时，给「升级到预发布」；装着的已是预发布、目录里有更新的预发布时也给（见 catalog.ts）
  const needPre = ext?.items.find((x) => x.offer?.uelink && !x.installed)?.offer?.uelink
  const pre = needPre ?? ext?.uelinkPreUpdate
  const bundledUp = !installed || canUpgrade(installed, s?.bundled)
  const offer = pre
    ? { version: pre, prerelease: true, blockers: [], pre }
    : bundledUp && s?.bundled
      ? { version: s.bundled, prerelease: /-/.test(s.bundled), blockers: [] }
      : undefined
  const exts = (ext?.items ?? []).filter((x) => x.installed && x.info?.requires?.UELink)
  return {
    name: 'UELink',
    displayName: 'UELink',
    description: ext?.uelink?.description ?? '',
    base: true,
    known: false,
    installed: installed
      ? { version: installed, rel: 'Plugins/UELink', mode: project.install?.mode === 'vcs' ? 'vcs' : 'local' }
      : undefined,
    offer,
    upgrade: !!installed && !!offer && canUpgrade(installed, offer.version),
    loaded: editorOf(s)?.bridge || undefined,
    info: ext?.uelink?.info,
    requiredBy: exts.map((x) => x.displayName),
    legacy: !!installed && canUpgrade(installed, '2.0.0'),
  }
}

export function extView(x: ExtensionStatus, link: PluginView): PluginView {
  const need = x.info?.requires?.UELink
  const linkTo = link.offer?.version
  const withUELink = !!need && !satisfies(link.installed?.version, need) && !!linkTo && satisfies(linkTo, need)
  // UELink 不够新那一条在安装时一起解决，不算拦住（服务端装扩展前会再查一遍）；
  // 刚升级完 UELink、扩展列表还没重取时，那一条也已经不成立了
  const linkOk = !!need && satisfies(link.installed?.version, need)
  const blockers = (x.offer?.blockers ?? []).filter((b) => !((withUELink || linkOk) && /UELink/.test(b)))
  return {
    name: x.name,
    displayName: x.displayName,
    description: x.description,
    base: false,
    known: x.known,
    installed: x.installed,
    offer: x.offer && { ...x.offer, blockers },
    upgrade: !!x.installed && !!x.offer && canUpgrade(x.installed.version, x.offer.version),
    loaded: x.loaded,
    info: x.info,
    requiredBy: [],
    withUELink,
  }
}

export type StateKey = 'running' | 'queued' | 'unpublished' | 'blocked' | 'missing' | 'upgrade' | 'stale' | 'latest'
export type CardTone = 'ok' | 'warn' | 'danger' | 'run' | 'muted'

/** 卡片右上角唯一的状态：全部升级进行中 > 装不了 > 未安装 > 可升级 > 编辑器里还是旧版 > 已是最新 */
export function cardState(v: PluginView, job?: Job): { tone: CardTone; key: StateKey } {
  const step = job?.status === 'running' ? job.steps?.find((s) => s.name === v.name) : undefined
  if (step?.status === 'run') return { tone: 'run', key: 'running' }
  if (step?.status === 'wait') return { tone: 'muted', key: 'queued' }
  if (!v.installed) {
    if (!v.offer) return { tone: 'muted', key: 'unpublished' }
    if (v.offer.blockers.length) return { tone: 'danger', key: 'blocked' }
    return { tone: 'muted', key: 'missing' }
  }
  if (v.upgrade) return { tone: 'warn', key: 'upgrade' }
  if (v.loaded && v.loaded !== v.installed.version) return { tone: 'warn', key: 'stale' }
  return { tone: 'ok', key: 'latest' }
}

/** 「全部升级」的计划：UELink 先（扩展要的版本靠它），再是装着且能升级、没被拦住的扩展 */
export function upgradePlan(link: PluginView, exts: PluginView[]) {
  const list = exts.filter((x) => x.installed && x.upgrade && !x.offer?.blockers.length)
  const uelink = link.upgrade || list.some((x) => x.withUELink) ? { prerelease: link.offer?.pre ?? '' } : undefined
  return {
    uelink,
    extensions: list.map((x) => ({ name: x.name, version: x.offer!.version, mode: x.installed!.mode })),
    count: list.length + (uelink ? 1 : 0),
  }
}

/** 编辑器里实际加载的版本和装的不一样：编译后重启编辑器才用上 */
export const isStale = (v: PluginView) => !!v.installed && !!v.loaded && v.loaded !== v.installed.version
