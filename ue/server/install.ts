import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { endJob, jobLog, newJob, runningJob, spawnJob } from './jobs.ts'
import { guardBuild } from './build-guard.ts'
import { blockerLines, LIVE_CODING_BLOCK } from './procs.ts'
import type { InstallMode, Job, UeProject } from './types.ts'
import { unzipTo } from './unzip.ts'
import {
  bestSource,
  bundledVersion,
  cmpVersion,
  downloadZip,
  findPluginDirs,
  OLD_PLUGINS,
  pluginVersion,
  UELINK,
} from './uelink.ts'
import { c, exists, run, t } from './util.ts'

export { bundledVersion }

/**
 * UE 端插件 UELink 的安装、卸载和编译（设计文档 4.4；安装约定见 UELink 仓库 docs/protocol.md 第 5 节）：
 * 自带的和公共库最新的取高的，项目里已经是更新的（UEToVS 装的）就不动；源码复制到 <项目>/Plugins/UELink/，
 * 顺手清掉合进 UELink 的旧插件（AgentPanelBridge、UEToVSLink）。
 * 「只在本机」写进 ignore（git 的 info/exclude、P4 的 .p4ignore），「加入版本管理」就 git add / p4 add（进默认变更列表，不提交）。
 */
const REL = path.join('Plugins', UELINK)
const ignoreLine = (name: string) => `Plugins/${name}/`

async function appendLine(file: string, line: string) {
  const old = await readFile(file, 'utf8').catch(() => '')
  if (old.split(/\r?\n/).some((l) => l.trim() === line)) return false
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${old}${old && !old.endsWith('\n') ? '\n' : ''}# Agent 面板 UE 插件（只在本机）\n${line}\n`)
  return true
}

async function removeLine(file: string, line: string) {
  const old = await readFile(file, 'utf8').catch(() => '')
  if (!old) return
  const kept = old
    .split(/\r?\n/)
    .filter((l, i, all) => l.trim() !== line && !(l.startsWith('# Agent 面板 UE 插件') && all[i + 1]?.trim() === line))
  await writeFile(file, kept.join('\n'))
}

/** git 的本机忽略文件（worktree 也指到主仓库的 info/exclude） */
async function gitExclude(root: string) {
  const r = await run('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'])
  if (r.code !== 0) return ''
  const p = r.out.trim()
  return path.isAbsolute(p) ? p : path.join(root, p)
}

/** 相对 git 仓库根的插件路径（UE 项目可能在仓库的子目录里） */
async function gitRel(root: string, name: string) {
  const r = await run('git', ['-C', root, 'rev-parse', '--show-prefix'])
  return `/${(r.out.trim() + ignoreLine(name)).replace(/\\/g, '/')}`
}

const p4ignore = (p: UeProject) => path.join(p.root, process.env.P4IGNORE?.split(/[;:]/)[0] || '.p4ignore')

async function markLocal(job: Job, p: UeProject) {
  if (p.vcs === 'git') {
    const f = await gitExclude(p.root)
    if (f && (await appendLine(f, await gitRel(p.root, UELINK)))) jobLog(job, t('已写进 {f}', { f }))
  } else if (p.vcs === 'p4') {
    const f = p4ignore(p)
    if (await appendLine(f, ignoreLine(UELINK))) jobLog(job, t('已写进 {f}', { f }))
  } else if (p.vcs === 'svn') {
    jobLog(job, t('SVN 不会自动加入新文件，不用改忽略设置'))
  }
}

/** 去掉某个插件的本机忽略行（卸载 UELink、清掉旧插件时用） */
async function unmarkLocal(p: UeProject, name: string) {
  if (p.vcs === 'git') {
    const f = await gitExclude(p.root)
    if (f) await removeLine(f, await gitRel(p.root, name))
  } else if (p.vcs === 'p4') {
    await removeLine(p4ignore(p), ignoreLine(name))
  }
}

async function vcsAdd(job: Job, p: UeProject) {
  const dir = path.join(p.root, REL)
  const r =
    p.vcs === 'git'
      ? await run('git', ['-C', p.root, 'add', '--', REL])
      : p.vcs === 'p4'
        ? await run('p4', ['-d', p.root, 'add', '-c', 'default', path.join(dir, '...')], {
            cwd: p.root,
            timeout: 60000,
          })
        : p.vcs === 'svn'
          ? await run('svn', ['add', '--force', dir], { cwd: p.root, timeout: 60000 })
          : { code: 0, out: '', err: '' }
  jobLog(job, r.out + r.err)
  if (r.code !== 0) throw new Error(t('加入版本管理失败：{msg}', { msg: (r.err || r.out).trim() }))
}

/** 删一个插件目录；编辑器开着时 DLL 被占用删不掉，报清楚 */
async function removeDir(dir: string) {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch {
    throw new Error(t('删不掉 {dest}：UE 编辑器开着时插件的 DLL 被占用，关掉编辑器再试', { dest: dir }))
  }
}

/** .uproject 的 Plugins 列表里去掉这些插件的条目（显式启用过旧插件的项目，删了目录不删条目会报找不到插件） */
async function dropFromUproject(p: UeProject, names: string[]) {
  const txt = await readFile(p.uproject, 'utf8').catch(() => '')
  if (!txt) return []
  let doc: { Plugins?: { Name?: string }[] }
  try {
    doc = JSON.parse(txt.replace(/^\uFEFF/, ''))
  } catch {
    return []
  }
  const before = doc.Plugins?.length ?? 0
  if (!doc.Plugins) return []
  const dropped = doc.Plugins.filter((x) => x.Name && names.includes(x.Name)).map((x) => x.Name!)
  if (!dropped.length) return []
  doc.Plugins = doc.Plugins.filter((x) => !(x.Name && names.includes(x.Name)))
  if (before && !doc.Plugins.length) delete doc.Plugins
  // UE 自己写 .uproject 用 tab 缩进
  await writeFile(p.uproject, `${JSON.stringify(doc, null, '\t')}\n`)
  return dropped
}

/** 清掉合进 UELink 的旧插件：目录、本机忽略行、.uproject 条目；P4 上加过版本管理的走 p4 delete（进默认变更列表，不提交） */
async function removeOldPlugins(job: Job, p: UeProject) {
  for (const name of OLD_PLUGINS) {
    for (const dir of await findPluginDirs(p.root, name)) {
      if (p.vcs === 'p4') {
        const r = await run('p4', ['-d', p.root, 'delete', '-c', 'default', path.join(dir, '...')], {
          cwd: p.root,
          timeout: 60000,
        })
        if (r.code === 0 && r.out.trim()) jobLog(job, r.out.trim())
      }
      await removeDir(dir)
      jobLog(job, t('已删除旧插件 {name}（{dir}），它的功能已经合进 UELink', { name, dir }))
      await unmarkLocal(p, name)
    }
  }
  const dropped = await dropFromUproject(p, OLD_PLUGINS)
  if (dropped.length) jobLog(job, t('已从 .uproject 的插件列表里去掉 {names}', { names: dropped.join('、') }))
}

export async function install(p: UeProject, mode: InstallMode) {
  const job = newJob(p.id, 'install', t('安装 UELink'))
  let tmp = ''
  try {
    const dest = path.join(p.root, REL)
    const installed = await pluginVersion(path.join(dest, `${UELINK}.uplugin`))
    const { source, remoteError } = await bestSource(true)
    if (remoteError) jobLog(job, t('公共库读不到（{e}），用插件自带的 UELink {v}', { e: remoteError, v: source.version }))
    await removeOldPlugins(job, p)
    if (installed && installed !== '?' && cmpVersion(installed, source.version) >= 0) {
      // 只升不降：另一个工具（UEToVS）装了更新的就不动
      jobLog(job, t('项目里已经是 UELink {v}，不用更新', { v: installed }))
    } else {
      let srcDir = source.kind === 'bundled' ? source.dir : ''
      if (source.kind === 'remote') {
        jobLog(job, t('从公共库下载 UELink {v}', { v: source.version }))
        tmp = await mkdtemp(path.join(os.tmpdir(), 'uelink-'))
        await unzipTo(await downloadZip(source), tmp)
        srcDir = path.join(tmp, UELINK)
        if (!exists(path.join(srcDir, `${UELINK}.uplugin`))) throw new Error(t('源码包里没有 UELink/UELink.uplugin'))
      }
      // 只换源码和配置：旧的 Binaries / Intermediate 留着会被 UBT 按时间戳重编，不用删
      await rm(path.join(dest, 'Source'), { recursive: true, force: true })
      await rm(path.join(dest, 'Config'), { recursive: true, force: true })
      await mkdir(dest, { recursive: true })
      await cp(srcDir, dest, { recursive: true, filter: (f) => !/[\\/](Binaries|Intermediate)([\\/]|$)/.test(f) })
      jobLog(job, t('已把 UELink {v} 复制到 {dest}', { v: source.version, dest }))
    }
    // 安装记录：UEToVS 升级时沿用同样的模式（docs/protocol.md 第 5 节）
    await writeFile(
      path.join(dest, '.install.json'),
      `${JSON.stringify({ version: (await pluginVersion(path.join(dest, `${UELINK}.uplugin`))) || source.version, by: 'agent-panel', source: source.kind === 'bundled' ? 'bundled' : c().config().uelinkSource ? 'mirror' : 'github', mode, at: new Date().toISOString() }, null, 2)}\n`,
    )
    if (mode === 'local') await markLocal(job, p)
    else await vcsAdd(job, p)
    endJob(job, true)
  } catch (e) {
    jobLog(job, (e as Error).message)
    endJob(job, false)
    throw e
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
  return job
}

/** 卸载：删 Plugins/UELink（还留着旧版桥接 AgentPanelBridge 的也一起删）。UELink 是和 UEToVS 共用的，删了 UEToVS 也连不上 */
export async function uninstall(p: UeProject) {
  const job = newJob(p.id, 'uninstall', t('卸载 UELink'))
  for (const name of [UELINK, 'AgentPanelBridge']) {
    for (const dest of await findPluginDirs(p.root, name)) {
      const rel = path.relative(p.root, dest)
      if (p.install?.mode === 'vcs' && p.vcs === 'p4') {
        // 已经 p4 add 过还没提交的先撤掉；提交过的要删就交给用户（不自动提交，设计文档 3.6）
        const r = await run('p4', ['-d', p.root, 'revert', '-k', path.join(dest, '...')], { cwd: p.root, timeout: 60000 })
        jobLog(job, r.out + r.err)
      } else if (p.install?.mode === 'vcs' && p.vcs === 'git') {
        const r = await run('git', ['-C', p.root, 'rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', rel])
        jobLog(job, r.out + r.err)
      }
      try {
        await removeDir(dest)
      } catch (e) {
        jobLog(job, (e as Error).message)
        endJob(job, false)
        throw e
      }
      await unmarkLocal(p, name)
      jobLog(job, t('已删除 {dest}', { dest }))
    }
  }
  jobLog(job, t('UELink 和 UEToVS 共用：UEToVS 的日志窗口、Live Coding 也会连不上，要用时在 UEToVS 里重新安装'))
  endJob(job, true)
  return job
}

/** 编辑器目标名：C++ 项目是 <项目>Editor，纯蓝图项目用引擎的 UnrealEditor 目标带 -Project 编项目插件 */
function buildArgs(p: UeProject) {
  const plat = process.platform === 'win32' ? 'Win64' : process.platform === 'darwin' ? 'Mac' : 'Linux'
  const script =
    process.platform === 'win32'
      ? path.join(p.engine.dir, 'Engine', 'Build', 'BatchFiles', 'Build.bat')
      : path.join(p.engine.dir, 'Engine', 'Build', 'BatchFiles', plat, 'Build.sh')
  const target = p.cpp ? `${p.uname}Editor` : 'UnrealEditor'
  return { script, args: [target, plat, 'Development', `-Project=${p.uproject}`, '-WaitMutex', '-NoHotReload'] }
}

/** UBT 找不到 C++ 工具链时的报错（没装 VS 或没装 C++ 组件） */
const NO_TOOLCHAIN =
  /Unable to find valid .*toolchain|No valid Visual C\+\+ toolchain|Visual Studio \d+ must be installed|No Visual Studio installation/i

/**
 * 编译：有自定义命令按它（整行交给 shell），否则用引擎的 Build.bat。
 * 用 Build.bat 时先过 guardBuild（build-guard.ts）：编辑器开着或 Live Coding 的锁还在就不跑，作业带上 hint，网页给出处理方式；
 * force 跳过检查（检查认错时用）；kill 先强制结束占着的进程再编（用户在网页上确认过未保存的改动会丢）。
 * 不管哪种方式，输出里出现 Live Coding 拒绝编译也带上 hint。
 */
export async function build(p: UeProject, opts: { force?: boolean; kill?: boolean } = {}) {
  const { force = false, kill = false } = opts
  const busy = runningJob(p.id, 'build')
  if (busy) return busy
  const job = newJob(p.id, 'build', t('编译项目（含桥接插件）'))
  const finish = (ok: Promise<boolean>) =>
    void ok.then(() => {
      if (!job.hint && !job.canceled && job.status === 'failed' && job.log.some((l) => LIVE_CODING_BLOCK.test(l))) {
        job.hint = { kind: 'live-coding', blockers: [] }
        for (const l of blockerLines([]).slice(1)) jobLog(job, l)
      }
      // 纯蓝图项目也可能装好了 VS（日志里能看到「Using Visual Studio … toolchain」），
      // 所以只在编译失败、且 UBT 说找不到 C++ 工具链时才提示装 VS，普通的编译报错不提示
      if (!p.cpp && job.status === 'failed' && job.log.some((l) => NO_TOOLCHAIN.test(l)))
        jobLog(job, t('纯蓝图项目：编译桥接插件需要本机装好 Visual Studio（含「使用 C++ 的游戏开发」）'))
    })
  if (p.buildCmd.trim()) {
    finish(
      spawnJob(
        job,
        process.platform === 'win32' ? 'cmd.exe' : 'sh',
        process.platform === 'win32' ? ['/d', '/s', '/c', p.buildCmd] : ['-c', p.buildCmd],
        p.root,
      ),
    )
    return job
  }
  if (!p.engine.dir) {
    jobLog(job, t('没找到引擎目录，没法编译：在「桥接与权限」里指定引擎目录或填编译命令'))
    endJob(job, false)
    return job
  }
  const { script, args } = buildArgs(p)
  if (!exists(script)) {
    jobLog(job, t('引擎里没有编译脚本 {f}', { f: script }))
    endJob(job, false)
    return job
  }
  if (!force && !(await guardBuild(p, job, kill))) return job
  finish(spawnJob(job, script, args, p.root))
  return job
}
