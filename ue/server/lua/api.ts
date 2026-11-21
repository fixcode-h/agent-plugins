import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import type { OpCtx } from '../ops.ts'
import { openWithSystem, revealInFolder } from '../reveal.ts'
import { t } from '../util.ts'
import { luaSettingsFile, readLuaSettings, saveLuaSettings } from './settings.ts'

/**
 * Lua 页（模块、报错页签）的本机动作：用系统默认程序打开 .lua、在文件夹里显示。挂在 /api/plugins/ue/p/<项目>/lua/ 下。
 * 报错里的位置常是相对脚本根目录的（UI/BagPanel.lua），root 是 lua.modules 回的脚本根目录；只认项目目录里的 .lua
 */
export async function luaRoute(ctx: OpCtx, route: string, b: Record<string, unknown>) {
  // 「权限与设置 → Lua」：读、存（lua/settings.ts）
  if (route === 'GET lua/settings')
    return { settings: await readLuaSettings(ctx.project), file: luaSettingsFile(ctx.project).write }
  if (route === 'POST lua/settings') return { settings: await saveLuaSettings(ctx.project, b.settings) }
  if (route !== 'POST lua/file' && route !== 'POST lua/snippet') return undefined
  const abs = await resolveLua(ctx, b)
  // 报错详情里的源码片段：出错行前后各 3 行
  if (route === 'POST lua/snippet') {
    const lines = (await readFile(abs, 'utf8')).split(/\r?\n/)
    const line = Math.max(1, Number(b.line) || 1)
    const from = Math.max(1, line - 3)
    return { path: abs, from, lines: lines.slice(from - 1, line + 3) }
  }
  if (b.action === 'reveal') revealInFolder(abs)
  else openWithSystem(abs)
  return { path: abs }
}

async function resolveLua(ctx: OpCtx, b: Record<string, unknown>) {
  const proj = path.resolve(ctx.project.root)
  const raw = String(b.file ?? '').replace(/:\d+$/, '')
  const base = b.root ? path.resolve(proj, String(b.root)) : path.join(proj, 'Content', 'Script')
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw)
  const rel = path.relative(proj, abs)
  if (!raw || rel.startsWith('..') || path.isAbsolute(rel) || !/\.lua$/i.test(abs))
    throw new BridgeError(t('只能打开项目目录里的 .lua 文件：{file}', { file: raw }))
  if (
    !(await stat(abs).then(
      (s) => s.isFile(),
      () => false,
    ))
  )
    throw new BridgeError(t('找不到文件：{file}', { file: abs }))
  return abs
}
