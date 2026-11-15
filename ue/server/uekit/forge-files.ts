import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
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
