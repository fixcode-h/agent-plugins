import { cp, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { jobLog } from './jobs.ts'
import type { Job } from './types.ts'
import { exists, t } from './util.ts'

/**
 * 把新版插件源码换进项目的 Plugins/<插件>/（UELink 和 UEKit 扩展共用）。
 *
 * 以前是「先删 Source、Config，再复制新的」：Windows 上杀毒、索引、VS 偶尔占着一个文件，删到一半就报错，
 * 已经删掉的 Build.cs 回不来，新文件也没复制进去，UBT 就报 Could not find definition for module 'UELinkCore'。
 * 现在先把旧文件整体挪进项目的 Intermediate/AgentPanel/（同一个盘，挪目录是一次改名，要么成要么不成），
 * 再复制新的、核对每个模块的 Build.cs 都在；中途失败就删掉复制了一半的、把旧的挪回来，项目回到装之前的样子。
 */

/** 留在插件目录里不动的：编好的二进制让 UBT 按时间戳重编；.install.json 由调用方重写 */
const KEEP = /^(Binaries|Intermediate|\.install\.json)$/i
const skipBuilt = (f: string) => !/[\\/](Binaries|Intermediate)([\\/]|$)/.test(f)

/** Windows 上文件被短暂占用时的错误：等一下再试几次（杀毒、索引扫完就放开了） */
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])
async function retry<T>(fn: () => Promise<T>, times = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= times - 1 || !BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e
      await new Promise((r) => setTimeout(r, 250 * (i + 1)))
    }
  }
}

/** .uplugin 里声明了、但 Source/<模块>/<模块>.Build.cs 不在的模块名（插件目录不全时 UBT 报找不到模块定义） */
export async function missingModules(dir: string, name: string): Promise<string[]> {
  let doc: { Modules?: { Name?: string }[] }
  try {
    doc = JSON.parse((await readFile(path.join(dir, `${name}.uplugin`), 'utf8')).replace(/^﻿/, ''))
  } catch {
    return []
  }
  return (doc.Modules ?? [])
    .map((m) => m.Name ?? '')
    .filter((m) => m && !exists(path.join(dir, 'Source', m, `${m}.Build.cs`)))
}

/**
 * 用 src 目录（解压好的插件，含 <name>.uplugin）替换 dest 里的插件文件。projectRoot 用来放挪走的旧文件。
 * 失败时抛出能直接给用户看的错误，dest 保持原样。
 */
export async function swapPluginFiles(job: Job, src: string, dest: string, name: string, projectRoot: string) {
  const trash = path.join(projectRoot, 'Intermediate', 'AgentPanel', `old-${name}-${Date.now()}`)
  const moved: string[] = []
  await mkdir(dest, { recursive: true })
  // 换掉的是新包里有的那几项，外加整个 Source、Config（旧版有、新版删掉的源码不能留着）；用户自己放的其他文件不动
  const incoming = (await readdir(src)).filter((n) => !KEEP.test(n))
  const replaced = new Set([...incoming, 'Source', 'Config'])
  const old = (await readdir(dest)).filter((n) => !KEEP.test(n) && replaced.has(n))
  const restore = async () => {
    // 先删掉复制了一半的新文件，再把旧的挪回来
    for (const n of incoming)
      await retry(() => rm(path.join(dest, n), { recursive: true, force: true })).catch(() => {})
    for (const n of moved) await retry(() => rename(path.join(trash, n), path.join(dest, n))).catch(() => {})
  }
  try {
    if (old.length) await mkdir(trash, { recursive: true })
    for (const n of old) {
      await retry(() => rename(path.join(dest, n), path.join(trash, n)))
      moved.push(n)
    }
  } catch (e) {
    await restore()
    throw new Error(
      t('{name} 的旧文件挪不开（{msg}）：有程序占着插件目录里的文件，关掉 UE 编辑器和打开了插件源码的 VS 再试', {
        name,
        msg: (e as Error).message,
      }),
    )
  }
  try {
    await cp(src, dest, { recursive: true, filter: skipBuilt })
    const missing = await missingModules(dest, name)
    if (missing.length) throw new Error(t('复制后缺少模块 {mods} 的 Build.cs', { mods: missing.join('、') }))
  } catch (e) {
    await restore()
    throw new Error(t('{name} 没装进去，已经恢复成原来的文件：{msg}', { name, msg: (e as Error).message }))
  }
  if (moved.length)
    await retry(() => rm(trash, { recursive: true, force: true })).catch((e: Error) =>
      jobLog(job, t('旧文件 {dir} 没删掉（{msg}），不影响编译，可以手动删', { dir: trash, msg: e.message })),
    )
}
