import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { OpCtx } from '../ops.ts'
import { t } from '../util.ts'
import { inProject, luaBuildConfig, saveLuaBuildConfig } from './config.ts'
import { changedFiles } from './changes.ts'
import { luaBuildApproved, luaBuildFile } from './store.ts'
import { currentBuild, startLuaBuild, stopLuaBuild } from './run.ts'

/**
 * Lua 页「编译」页签的接口（挂在 /api/plugins/ue/p/<项目>/lua-build… 下）。网页上的操作记成 actor=user；
 * 编译只能跑设置里配好的两条指令，这里不收命令行。不认识的路径返回 undefined 交回 api.ts
 */
export async function luaBuildRoute(ctx: OpCtx, key: string, b: Record<string, unknown>): Promise<unknown> {
  const p = ctx.project
  switch (key) {
    case 'GET lua-build': {
      const config = luaBuildConfig(p)
      const dir = inProject(p, config.scriptDir)
      return {
        config,
        // 团队共用的那份存在哪（设置页显示）；指令是从仓库拉来、本机还没确认过的，设置页提示先确认
        sharedFile: luaBuildFile(p).write,
        ...((await luaBuildApproved(p)) ? {} : { unapproved: true }),
        scriptDirExists: existsSync(dir),
        changes: await changedFiles(p, dir),
        current: currentBuild(p.id),
      }
    }
    case 'POST lua-build/config':
      return { config: await saveLuaBuildConfig(p, b) }
    case 'POST lua-build/run': {
      const mode = b.mode === 'full' ? 'full' : 'incremental'
      const files = Array.isArray(b.files) ? b.files.map(String) : undefined
      return { run: await startLuaBuild(ctx, mode, files) }
    }
    case 'POST lua-build/stop':
      return stopLuaBuild(p.id)
    case 'POST lua-build/open':
      return openAt(ctx, String(b.file ?? ''), Number(b.line) || 1)
  }
  return undefined
}

/**
 * 用编辑器打开报错的位置：设置里配了编辑器命令（{file}、{line}）就用它跳到那一行，没配交给系统默认程序（不跳行）。
 * 只开项目里的文件，免得网页借这个接口打开任意路径
 */
function openAt(ctx: OpCtx, file: string, line: number) {
  const p = ctx.project
  const abs = path.resolve(p.root, file)
  const rel = path.relative(p.root, abs)
  if (!file || rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error(t('只能打开项目里的文件：{p}', { p: file }))
  if (!existsSync(abs)) throw new Error(t('文件不存在：{p}', { p: file }))
  const tpl = luaBuildConfig(p).editor
  if (tpl) {
    const cmd = tpl.replaceAll('{file}', abs).replaceAll('{line}', String(line))
    const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => undefined)
    child.unref()
    return { ok: true, how: 'editor' }
  }
  const [bin, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '""', abs]]
      : process.platform === 'darwin'
        ? ['open', [abs]]
        : ['xdg-open', [abs]]
  const child = spawn(bin, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)
  child.unref()
  return { ok: true, how: 'system' }
}
