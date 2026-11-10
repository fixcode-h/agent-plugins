import { BridgeError } from './instances.ts'
import type { UeProject } from './types.ts'
import { t } from './util.ts'

/**
 * 资源搜索的输入整理。桥接的 assets 只拿「名字前缀」比资源名（DT_Item），目录只认 UE 包路径（/Game/...），
 * 用户常把资源管理器里复制的磁盘路径（G:/Proj/Content/LogicRes）或 /Game 路径直接贴进前缀框，
 * 原样发过去必然「没有找到」。这里把路径拆成「目录 + 名字前缀」，磁盘路径按项目的 Content 换成包路径。
 */
export interface AssetQuery {
  path: string
  prefix: string
  /** 输入是一个目录还是「目录/名字开头」分不清时，先按目录搜，没结果再按名字前缀搜 */
  fallback?: { path: string; prefix: string }
}

const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')

/** 磁盘路径 → 包路径：项目 Content → /Game，插件 Content → /<插件名>；不在 Content 里的报错 */
function diskToPackage(p: string, root: string): string {
  const r = norm(root)
  const lower = p.toLowerCase()
  let rel = lower.startsWith(r.toLowerCase() + '/') ? p.slice(r.length + 1) : ''
  if (!rel) {
    // 别的工作区 / 盘符下的同一个项目：认路径里最后一个 Content
    const i = lower.lastIndexOf('/content/')
    const end = lower.endsWith('/content') ? p.length - '/content'.length : -1
    if (i < 0 && end < 0) throw new BridgeError(t('{p} 不在项目的 Content 目录里', { p }))
    const at = i >= 0 ? i : end
    const before = p.slice(0, at)
    const plugin = /\/Plugins\/(?:.+\/)?([^/]+)$/i.exec(before)
    return (plugin ? `/${plugin[1]}` : '/Game') + p.slice(at + '/content'.length)
  }
  const m = /^Content(\/.*)?$/i.exec(rel)
  if (m) return '/Game' + (m[1] ?? '')
  const pm = /^Plugins\/(?:.+\/)?([^/]+)\/Content(\/.*)?$/i.exec(rel)
  if (pm) return `/${pm[1]}` + (pm[2] ?? '')
  throw new BridgeError(t('{p} 不在项目的 Content 目录里', { p }))
}

export function assetQuery(project: UeProject, rawPrefix: unknown, rawPath: unknown): AssetQuery {
  const base = norm(String(rawPath || '/Game')) || '/Game'
  const input = String(rawPrefix ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
  if (!/[\\/]/.test(input)) return { path: base, prefix: input }

  let p = norm(input)
  // 磁盘路径：盘符开头、UNC，或以项目目录开头
  if (/^[a-z]:\//i.test(p) || p.startsWith('//') || p.toLowerCase().startsWith(norm(project.root).toLowerCase()))
    p = diskToPackage(p, project.root)
  else if (!p.startsWith('/')) p = `${base}/${p}`
  // 复制来的对象路径（/Game/A/DT_X.DT_X）、文件名（DT_X.uasset）都是具体资源：目录 + 名字
  const file = /\.(uasset|umap)$/i.test(p) || /\.[^/]+$/.test(p.split('/').pop() ?? '')
  p = p.replace(/\.(uasset|umap)$/i, '').replace(/\.[^/]*$/, '')
  const cut = p.lastIndexOf('/')
  const dir = cut > 0 ? p.slice(0, cut) : p
  const name = cut > 0 ? p.slice(cut + 1) : ''
  if (file) return { path: dir, prefix: name }
  // 只有挂载点（/Game）时没有可拆的名字
  if (cut <= 0) return { path: p, prefix: '' }
  return { path: p, prefix: '', fallback: { path: dir, prefix: name } }
}
