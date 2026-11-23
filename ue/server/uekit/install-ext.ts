import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { swapPluginFiles } from '../install-files.ts'
import { dropFromUproject, markLocal, removeDir, unmarkLocal, vcsAdd } from '../install.ts'
import { endJob, jobLog, newJob } from '../jobs.ts'
import type { InstallMode, UeProject } from '../types.ts'
import { unzipTo } from '../unzip.ts'
import { downloadZip, findPluginDirs } from '../uelink.ts'
import { c, exists, run, t } from '../util.ts'
import { blockers, installedIn, manifestFor } from './catalog.ts'

/**
 * 装、升级、卸载 UEKit 的扩展插件（AssetForge、GameTest），约定和 UELink 一样（UEKit docs/protocol.md 第 5 节）：
 * 下载要校验 sha256；只换源码和配置，留着 Binaries / Intermediate 让 UBT 按时间戳重编；
 * 清掉 replaces 里的旧插件（TkAssetForge 之类）；只在本机写进忽略，加入版本管理只 add 不提交。
 * 扩展没有自带的一份：只从插件目录（GitHub 或镜像）装。
 */
export async function installExtension(p: UeProject, name: string, opts: { version?: string; mode?: InstallMode }) {
  const mode: InstallMode = opts.mode ?? (p.install?.mode === 'vcs' ? 'vcs' : 'local')
  const job = newJob(p.id, 'install', t('安装 {name}', { name }))
  let tmp = ''
  try {
    const { manifest, base } = await manifestFor(name, opts.version)
    const problems = await blockers(p, manifest)
    if (problems.length) throw new Error(problems.join('\n'))
    const prev = await installedIn(p.root, name)
    const dest = prev?.dir ?? path.join(p.root, 'Plugins', name)

    jobLog(job, t('下载 {name} {v}', { name, v: manifest.version }))
    tmp = await mkdtemp(path.join(os.tmpdir(), 'uekit-'))
    await unzipTo(await downloadZip({ kind: 'remote', version: manifest.version, manifest, base }), tmp)
    const src = path.join(tmp, name)
    if (!exists(path.join(src, `${name}.uplugin`))) throw new Error(t('源码包里没有 {name}/{name}.uplugin', { name }))

    for (const old of manifest.replaces ?? []) {
      for (const dir of await findPluginDirs(p.root, old)) {
        if (p.vcs === 'p4') {
          const r = await run('p4', ['-d', p.root, 'delete', '-c', 'default', path.join(dir, '...')], {
            cwd: p.root,
            timeout: 60000,
          })
          if (r.code === 0 && r.out.trim()) jobLog(job, r.out.trim())
        }
        await removeDir(dir)
        await unmarkLocal(p, old)
        jobLog(job, t('已删除旧插件 {old}（{dir}），{name} 替代了它', { old, dir, name }))
      }
    }
    const dropped = await dropFromUproject(p, manifest.replaces ?? [])
    if (dropped.length) jobLog(job, t('已从 .uproject 的插件列表里去掉 {names}', { names: dropped.join('、') }))

    // 失败时恢复原样，不留删了一半的 Source（install-files.ts）
    await swapPluginFiles(job, src, dest, name, p.root)
    jobLog(job, t('已把 {name} {v} 复制到 {dest}', { name, v: manifest.version, dest }))
    await writeFile(
      path.join(dest, '.install.json'),
      `${JSON.stringify({ version: manifest.version, by: 'agent-panel', source: c().config().uekitSource ? 'mirror' : 'github', mode, at: new Date().toISOString() }, null, 2)}\n`,
    )
    // 装在别处（分组目录）的不改位置，忽略行和版本管理按实际目录名走
    const dirName = path.relative(path.join(p.root, 'Plugins'), dest).replace(/\\/g, '/')
    if (mode === 'local') await markLocal(job, p, dirName)
    else await vcsAdd(job, p, dirName)
    jobLog(job, t('装好了：要完整编译一次（Live Coding 不够），再重启编辑器'))
    endJob(job, true)
  } catch (e) {
    jobLog(job, (e as Error).message)
    endJob(job, false)
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
  return job
}

/** 卸载扩展：删目录、去掉忽略行；加入过版本管理的撤掉 add（提交过的删除留给用户提交） */
export async function uninstallExtension(p: UeProject, name: string) {
  const job = newJob(p.id, 'uninstall', t('卸载 {name}', { name }))
  try {
    for (const dest of await findPluginDirs(p.root, name)) {
      const rel = path.relative(p.root, dest)
      if (p.vcs === 'p4') {
        const r = await run('p4', ['-d', p.root, 'revert', '-k', path.join(dest, '...')], {
          cwd: p.root,
          timeout: 60000,
        })
        jobLog(job, r.out + r.err)
      } else if (p.vcs === 'git') {
        const r = await run('git', ['-C', p.root, 'rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', rel])
        jobLog(job, r.out + r.err)
      }
      await removeDir(dest)
      await unmarkLocal(p, path.relative(path.join(p.root, 'Plugins'), dest).replace(/\\/g, '/'))
      jobLog(job, t('已删除 {dest}', { dest }))
    }
    const dropped = await dropFromUproject(p, [name])
    if (dropped.length) jobLog(job, t('已从 .uproject 的插件列表里去掉 {names}', { names: dropped.join('、') }))
    jobLog(job, t('重新编译、重启编辑器后生效'))
    endJob(job, true)
  } catch (e) {
    jobLog(job, (e as Error).message)
    endJob(job, false)
  }
  return job
}
