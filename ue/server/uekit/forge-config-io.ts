import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { t } from '../util.ts'
import { insideProject } from './gt-files.ts'

/**
 * AssetForge 页在面板这边读写配置文件（用户 2026-11-16 同意的五项扩展）：
 * - read / save：「配置原文」页签里直接编辑保存。保存带上读出来时的修改时间，中间被编辑器或 Agent 改过就拒绝，不悄悄覆盖。
 * - templates：配置根下 `_templates/` 里项目自己放的模板（UEKit 扫描配置时跳过 `_` 开头的目录，所以模板不会被当成配置导入）。
 * - asset：新建配置前看目标资产在不在磁盘上（/Game/... ↔ Content/....uasset|.umap），不用起 UE。
 * 配置是项目文档根里给人看和改的 JSON，面板和 UE 在同一台机器，直接读写本机文件。
 */
/** 编辑器里一次最多读这么大：再大的配置去外部编辑器改 */
const MAX_EDIT = 2 * 1024 * 1024
const MAX_TEMPLATES = 200
const MAX_TEMPLATE_SIZE = 256 * 1024
export const TEMPLATE_DIR = '_templates'

function configFile(projectRoot: string, b: { root?: unknown; path?: unknown }) {
  const root = String(b.root ?? '')
  if (!root) throw new BridgeError(t('不知道配置根在哪：先刷新 AssetForge 页'))
  const rootAbs = insideProject(projectRoot, root)
  const rel0 = String(b.path ?? '').replace(/\\/g, '/')
  const abs = path.resolve(rootAbs, rel0)
  const rel = path.relative(rootAbs, abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.json$/i.test(abs))
    throw new BridgeError(t('只能读写配置根里的 .json 配置：{p}', { p: rel0 }))
  return { rootAbs, abs, rel: rel.replace(/\\/g, '/') }
}

export async function forgeReadConfig(projectRoot: string, b: { root?: unknown; path?: unknown }) {
  const f = configFile(projectRoot, b)
  const st = await stat(f.abs).catch(() => undefined)
  if (!st?.isFile()) throw new BridgeError(t('文件不存在：{p}', { p: f.rel }))
  if (st.size > MAX_EDIT)
    throw new BridgeError(t('配置太大（{n} KB），用编辑器打开改', { n: Math.round(st.size / 1024) }))
  return { path: f.rel, text: await readFile(f.abs, 'utf8'), mtime: st.mtime.toISOString() }
}

export async function forgeSaveConfig(
  projectRoot: string,
  b: { root?: unknown; path?: unknown; text?: unknown; mtime?: unknown },
) {
  const f = configFile(projectRoot, b)
  if (typeof b.text !== 'string') throw new BridgeError(t('没有要保存的内容'))
  const st = await stat(f.abs).catch(() => undefined)
  if (!st?.isFile()) throw new BridgeError(t('文件不存在：{p}', { p: f.rel }))
  // 打开编辑后文件又被别人存过：不覆盖，让用户先看新内容
  if (b.mtime && st.mtime.toISOString() !== String(b.mtime))
    throw new BridgeError(t('这份配置在你编辑时被改过了（编辑器或 Agent 存过盘）：先放弃修改看新内容，再重新编辑'))
  await writeFile(f.abs, b.text, 'utf8')
  const after = await stat(f.abs)
  return { path: f.rel, mtime: after.mtime.toISOString() }
}

/** 项目模板：_templates 下的 .json，每份原文带回去由页面解析（坏的也列出来，页面标「读不懂」） */
export async function forgeTemplates(projectRoot: string, b: { root?: unknown }) {
  const root = String(b.root ?? '')
  if (!root) throw new BridgeError(t('不知道配置根在哪：先刷新 AssetForge 页'))
  const dir = path.join(insideProject(projectRoot, root), TEMPLATE_DIR)
  const files: string[] = []
  const walk = async (d: string) => {
    const list = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of list) {
      if (files.length >= MAX_TEMPLATES) return
      const f = path.join(d, e.name)
      if (e.isDirectory()) await walk(f)
      else if (e.isFile() && /\.json$/i.test(e.name)) files.push(f)
    }
  }
  await walk(dir)
  const templates = await Promise.all(
    files.sort().map(async (f) => {
      const st = await stat(f)
      const rel = path.relative(dir, f).replace(/\\/g, '/')
      if (st.size > MAX_TEMPLATE_SIZE) return { path: rel, error: t('模板太大') }
      return { path: rel, text: await readFile(f, 'utf8') }
    }),
  )
  return { dir: TEMPLATE_DIR, templates }
}

/**
 * 目标资产在不在：只认 /Game/（项目 Content 下），插件的挂载点不猜，回 known: false。
 * 资产名带对象名（/Game/A/B.B）时去掉点后面那段
 */
export async function forgeAssetExists(projectRoot: string, b: { asset?: unknown }) {
  const asset = String(b.asset ?? '')
    .replace(/\\/g, '/')
    .replace(/\.[^/]*$/, '')
  if (!asset.startsWith('/Game/')) return { known: false }
  const base = path.join(projectRoot, 'Content', ...asset.slice('/Game/'.length).split('/'))
  for (const ext of ['.uasset', '.umap']) {
    const st = await stat(base + ext).catch(() => undefined)
    if (st?.isFile())
      return { known: true, exists: true, file: path.relative(projectRoot, base + ext).replace(/\\/g, '/') }
  }
  return { known: true, exists: false }
}
