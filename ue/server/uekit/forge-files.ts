import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { revealInFolder } from '../reveal.ts'
import { t } from '../util.ts'
import { insideProject } from './gt-files.ts'

/**
 * AssetForge 页右键菜单的本机动作：在文件夹中显示、用编辑器打开。配置是项目文档根里给人看和改的 JSON，
 * 面板和 UE 在同一台机器上，直接开本机的资源管理器 / 系统默认编辑器，不经 UE（UEKit 不用为这个发版）。
 * 只认配置根（forge.health 的 configRoot）里的文件和目录，出了配置根一律拒绝。
 */
export async function forgeFileAction(projectRoot: string, b: { root?: unknown; path?: unknown; action?: unknown }) {
  const root = String(b.root ?? '')
  if (!root) throw new BridgeError(t('不知道配置根在哪：先刷新 AssetForge 页'))
  const rootAbs = insideProject(projectRoot, root)
  const abs = path.resolve(rootAbs, String(b.path ?? ''))
  const rel = path.relative(rootAbs, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new BridgeError(t('只能操作配置根里的文件：{p}', { p: String(b.path ?? '') }))
  const st = await stat(abs).catch(() => undefined)
  if (!st) throw new BridgeError(t('文件不存在：{p}', { p: rel || '.' }))
  const action = String(b.action ?? '')
  if (action === 'reveal') {
    // 目录直接打开它本身，文件在所在目录里选中
    if (st.isDirectory()) openWithSystem(abs)
    else revealInFolder(abs)
    return { path: rel.replace(/\\/g, '/') }
  }
  if (action === 'open') {
    if (!st.isFile() || !/\.json$/i.test(abs)) throw new BridgeError(t('只能用编辑器打开 .json 配置'))
    openWithSystem(abs)
    return { path: rel.replace(/\\/g, '/') }
  }
  throw new BridgeError(t('不认识的操作：{a}', { a: action }))
}

/**
 * 建配置根（用户 2026-11-16：打开 AssetForge 页就把配置根建好，不再显示「配置根还不存在」）。
 * 只在项目或项目外层的 ProjectDoc 里建（insideProject 管），配置根指到别处时报错，页面退回原来的空状态说明。
 */
export async function forgeEnsureRoot(projectRoot: string, b: { root?: unknown }) {
  const root = String(b.root ?? '')
  if (!root) throw new BridgeError(t('不知道配置根在哪：先刷新 AssetForge 页'))
  const abs = insideProject(projectRoot, root)
  await mkdir(abs, { recursive: true })
  return { created: true }
}

/**
 * 新建一份配置（模板新建、让 AI 写之前先建好目录）：path 相对配置根，必须是 .json；
 * text 为空时只建所在目录（AI 写的时候页面要盯这个目录，目录不在盯不了）。已有同名文件不覆盖。
 */
export async function forgeCreateConfig(projectRoot: string, b: { root?: unknown; path?: unknown; text?: unknown }) {
  const root = String(b.root ?? '')
  if (!root) throw new BridgeError(t('不知道配置根在哪：先刷新 AssetForge 页'))
  const rootAbs = insideProject(projectRoot, root)
  const rel0 = String(b.path ?? '').replace(/\\/g, '/')
  const abs = path.resolve(rootAbs, rel0)
  const rel = path.relative(rootAbs, abs)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.json$/i.test(abs))
    throw new BridgeError(t('只能在配置根里建 .json 配置：{p}', { p: rel0 }))
  await mkdir(path.dirname(abs), { recursive: true })
  const text = typeof b.text === 'string' ? b.text : ''
  const out: { path: string; exists?: boolean } = { path: rel.replace(/\\/g, '/') }
  if (!text) return { ...out, exists: !!(await stat(abs).catch(() => undefined)) }
  try {
    // wx：已经有这个文件就失败，不悄悄覆盖别人的配置
    await writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new BridgeError(t('已经有这份配置了：{p}，换个资产路径或名字', { p: out.path }))
    throw e
  }
  return out
}

/** 交给系统默认程序打开（.json 一般是用户设的编辑器，目录是资源管理器） */
function openWithSystem(abs: string) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '""', abs]]
      : process.platform === 'darwin'
        ? ['open', [abs]]
        : ['xdg-open', [abs]]
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)
  child.unref()
}
