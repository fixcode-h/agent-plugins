import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { endJob, jobLog, newJob, runningJob, spawnJob } from './jobs.ts'
import { blockerLines, editorBlockers, LIVE_CODING_BLOCK } from './procs.ts'
import type { InstallMode, Job, UeProject } from './types.ts'
import { c, exists, run, t } from './util.ts'

/**
 * 桥接插件的安装、卸载和编译（设计文档 4.4）：源码复制到 <项目>/Plugins/AgentPanelBridge/，
 * 「只在本机」写进 ignore（git 的 info/exclude、P4 的 .p4ignore），「加入版本管理」就 git add / p4 add（进默认变更列表，不提交）。
 */
const REL = path.join('Plugins', 'AgentPanelBridge')
const IGNORE_LINE = 'Plugins/AgentPanelBridge/'

export const bundledDir = () => path.join(c().dir, 'bridge', 'AgentPanelBridge')

export async function bundledVersion() {
  const txt = await readFile(path.join(bundledDir(), 'AgentPanelBridge.uplugin'), 'utf8').catch(() => '')
  try {
    return String(JSON.parse(txt).VersionName ?? '')
  } catch {
    return ''
  }
}

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
async function gitRel(root: string) {
  const r = await run('git', ['-C', root, 'rev-parse', '--show-prefix'])
  return `/${(r.out.trim() + IGNORE_LINE).replace(/\\/g, '/')}`
}

async function markLocal(job: Job, p: UeProject) {
  if (p.vcs === 'git') {
    const f = await gitExclude(p.root)
    if (f && (await appendLine(f, await gitRel(p.root)))) jobLog(job, t('已写进 {f}', { f }))
  } else if (p.vcs === 'p4') {
    const f = path.join(p.root, process.env.P4IGNORE?.split(/[;:]/)[0] || '.p4ignore')
    if (await appendLine(f, IGNORE_LINE)) jobLog(job, t('已写进 {f}', { f }))
  } else if (p.vcs === 'svn') {
    jobLog(job, t('SVN 不会自动加入新文件，不用改忽略设置'))
  }
}

async function unmarkLocal(p: UeProject) {
  if (p.vcs === 'git') {
    const f = await gitExclude(p.root)
    if (f) await removeLine(f, await gitRel(p.root))
  } else if (p.vcs === 'p4') {
    await removeLine(path.join(p.root, process.env.P4IGNORE?.split(/[;:]/)[0] || '.p4ignore'), IGNORE_LINE)
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

export async function install(p: UeProject, mode: InstallMode) {
  const job = newJob(p.id, 'install', t('安装桥接插件'))
  try {
    const dest = path.join(p.root, REL)
    // 只换源码：旧的 Binaries / Intermediate 留着会被 UBT 按时间戳重编，不用删
    await rm(path.join(dest, 'Source'), { recursive: true, force: true })
    await mkdir(dest, { recursive: true })
    await cp(bundledDir(), dest, { recursive: true })
    jobLog(job, t('已复制到 {dest}', { dest }))
    if (mode === 'local') await markLocal(job, p)
    else await vcsAdd(job, p)
    endJob(job, true)
  } catch (e) {
    jobLog(job, (e as Error).message)
    endJob(job, false)
    throw e
  }
  return job
}

export async function uninstall(p: UeProject) {
  const job = newJob(p.id, 'uninstall', t('卸载桥接插件'))
  const dest = path.join(p.root, REL)
  if (p.install?.mode === 'vcs' && p.vcs === 'p4') {
    // 已经 p4 add 过还没提交的先撤掉；提交过的要删就交给用户（不自动提交，设计文档 3.6）
    const r = await run('p4', ['-d', p.root, 'revert', '-k', path.join(dest, '...')], { cwd: p.root, timeout: 60000 })
    jobLog(job, r.out + r.err)
  } else if (p.install?.mode === 'vcs' && p.vcs === 'git') {
    const r = await run('git', ['-C', p.root, 'rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', REL])
    jobLog(job, r.out + r.err)
  }
  try {
    await rm(dest, { recursive: true, force: true })
  } catch (e) {
    jobLog(job, (e as Error).message)
    endJob(job, false)
    throw new Error(t('删不掉 {dest}：UE 编辑器开着时插件的 DLL 被占用，关掉编辑器再卸载', { dest }))
  }
  await unmarkLocal(p)
  jobLog(job, t('已删除 {dest}', { dest }))
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

/**
 * 编译：有自定义命令按它（整行交给 shell），否则用引擎的 Build.bat。
 * 用 Build.bat 时先查这个引擎的编辑器开没开（procs.ts 写了为什么）：开着就不跑，作业带上 hint，网页给出处理方式；
 * force 跳过检查（检查认错进程时用）。不管哪种方式，输出里出现 Live Coding 拒绝编译也带上 hint。
 */
export async function build(p: UeProject, force = false) {
  const busy = runningJob(p.id, 'build')
  if (busy) return busy
  const job = newJob(p.id, 'build', t('编译项目（含桥接插件）'))
  const finish = (ok: Promise<boolean>) =>
    void ok.then(() => {
      if (!job.hint && job.status === 'failed' && job.log.some((l) => LIVE_CODING_BLOCK.test(l))) {
        job.hint = { kind: 'live-coding', blockers: [] }
        for (const l of blockerLines([]).slice(1)) jobLog(job, l)
      }
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
  if (!force) {
    const { list, error } = await editorBlockers(p)
    if (error) jobLog(job, t('没能检查编辑器是否开着（照常编译）：{msg}', { msg: error }))
    if (list.length) {
      for (const l of blockerLines(list)) jobLog(job, l)
      job.hint = { kind: 'live-coding', blockers: list }
      endJob(job, false)
      return job
    }
  }
  if (!p.cpp) jobLog(job, t('纯蓝图项目：编译桥接插件需要本机装好 Visual Studio（含「使用 C++ 的游戏开发」）'))
  finish(spawnJob(job, script, args, p.root))
  return job
}
