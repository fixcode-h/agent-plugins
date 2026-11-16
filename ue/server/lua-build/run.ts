import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OpCtx } from '../ops.ts'
import type { LuaBuildRun } from '../types.ts'
import { c, run, t, uid } from '../util.ts'
import { compileErrorPattern, inProject, luaBuildConfig } from './config.ts'
import { changedFiles, luaFiles, moduleName, patchBuildState } from './changes.ts'
import { errorKey, parseErrorLine, stripAnsi, type ErrorDirs } from './errors.ts'

/**
 * 跑 Lua 编译（设计稿四.3）：在本机起进程（面板服务端，不经过 UE），输出逐行推给网页（事件 ue-lua-build），能停止。
 * 一个项目同时只跑一个。完整输出写进插件数据目录的文件，Agent 只拿路径和前几条错误（ADR 0067）。
 */
export const LUA_BUILD_EVENT = 'ue-lua-build'

/** 网页上留多少行输出（完整的在文件里） */
const MAX_LINES = 5000
/** 每个项目留几次的输出文件 */
const KEEP_LOGS = 10

interface Live {
  run: LuaBuildRun
  lines: string[]
  /** 一共出过多少行（lines 只留最后 MAX_LINES 行）：推送带上这批从第几行起，网页按它接，不重不漏 */
  total: number
  child?: ChildProcess
  log?: WriteStream
  pending: string[]
  timer?: ReturnType<typeof setTimeout>
  seen: Set<string>
  done: Promise<void>
}

/** 每个项目最近一次（正在跑的或刚结束的） */
const lives = new Map<string, Live>()

export function currentBuild(projectId: string) {
  const l = lives.get(projectId)
  if (!l) return undefined
  const lines = l.lines.slice(-2000)
  return { ...l.run, lines, droppedLines: l.total - lines.length }
}

export function buildRun(projectId: string, id: string) {
  const l = lives.get(projectId)
  return l && l.run.id === id ? l : undefined
}

function push(projectId: string, l: Live, final = false) {
  if (l.timer) clearTimeout(l.timer)
  l.timer = undefined
  const lines = l.pending.splice(0)
  c().pages.push(LUA_BUILD_EVENT, {
    project: projectId,
    id: l.run.id,
    from: l.total - lines.length,
    lines,
    errors: l.run.errors,
    ...(final ? { run: { ...l.run } } : {}),
  })
}

/** 输出一多，每行推一次太碎：攒 120 毫秒推一次 */
function addLine(projectId: string, l: Live, text: string, re: RegExp, dirs: ErrorDirs) {
  const line = stripAnsi(text).replace(/\r$/, '')
  l.lines.push(line)
  l.total++
  if (l.lines.length > MAX_LINES) l.lines.splice(0, l.lines.length - MAX_LINES)
  l.log?.write(line + '\n')
  l.pending.push(line)
  const err = parseErrorLine(re, line, dirs)
  if (err && !l.seen.has(errorKey(err))) {
    l.seen.add(errorKey(err))
    l.run.errors.push(err)
  }
  if (!l.timer) l.timer = setTimeout(() => push(projectId, l), 120)
}

/** 面板自己加的行（命令行、结束状态）不拿去认报错 */
const NONE = /$^/

const quote = (s: string) => (/[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

/** 起一次编译：mode=incremental 时 files 不给就编全部改过的。返回这次的记录（还在跑） */
export async function startLuaBuild(ctx: OpCtx, mode: 'full' | 'incremental', pick?: string[]): Promise<LuaBuildRun> {
  const p = ctx.project
  const cur = lives.get(p.id)
  if (cur?.run.status === 'running') throw new Error(t('这个项目已经有一次 Lua 编译在跑：等它结束或先停止'))
  const cfg = luaBuildConfig(p)
  const tpl = mode === 'full' ? cfg.full : cfg.incremental
  if (!tpl)
    throw new Error(
      mode === 'full'
        ? t('还没配全编译指令：到 UE 页「权限与设置」→ Lua 编译里填')
        : t('还没配增量编译指令：到 UE 页「权限与设置」→ Lua 编译里填'),
    )
  const re = compileErrorPattern(cfg.errorFormat)
  const scriptDir = inProject(p, cfg.scriptDir)
  const cwd = inProject(p, cfg.cwd)
  const id = uid()
  const dir = path.join(c().dataDir, 'lua-build', p.id)
  await mkdir(dir, { recursive: true })

  // 开编前改过的文件：增量编它们（网页可以勾掉一些）；全编译成功后自动重载的也是它们（全部重载太重，也没必要）
  const changed = (await changedFiles(p, scriptDir)).files.map((f) => f.path)
  const all = await luaFiles(scriptDir)
  const mtimes = new Map(all.map((f) => [f.path, f.mtime]))
  let files: string[] = []
  if (mode === 'incremental') {
    files = pick ? pick.filter((f) => /\.lua$/i.test(f) && !f.split(/[\\/]/).includes('..')) : changed
    if (!files.length) throw new Error(t('没有改过的 Lua 文件要编'))
  }
  const fileCount = mode === 'incremental' ? files.length : all.length
  const reloadFiles = mode === 'incremental' ? files : changed

  let command = tpl
    .replaceAll('{root}', quote(p.root))
    .replaceAll('{scripts}', quote(scriptDir))
    .replaceAll('{files}', files.map(quote).join(' '))
  if (command.includes('{filelist}')) {
    const listFile = path.join(dir, `${id}.files.txt`)
    await writeFile(listFile, files.join('\n') + '\n')
    command = command.replaceAll('{filelist}', quote(listFile))
  }

  const logFile = path.join(dir, `${id}.log`)
  const r: LuaBuildRun = {
    id,
    mode,
    status: 'running',
    command,
    files,
    fileCount,
    startedAt: Date.now(),
    errors: [],
    logFile,
    by: ctx.actor.kind === 'agent' ? 'agent' : 'user',
  }
  let finish!: () => void
  const live: Live = {
    run: r,
    lines: [],
    total: 0,
    pending: [],
    seen: new Set(),
    log: createWriteStream(logFile),
    done: new Promise((res) => (finish = res)),
  }
  lives.set(p.id, live)
  const dirs: ErrorDirs = { root: p.root, cwd, scriptDir }
  addLine(p.id, live, `> ${command}`, NONE, dirs)

  // 命令行是用户在设置里写的整行（可能带管道、.bat），交给 shell 执行；非 Windows 单独成组，停止时连子进程一起结束
  const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' })
  live.child = child
  let buf = { out: '', err: '' }
  const feed = (k: 'out' | 'err', d: Buffer) => {
    const parts = (buf[k] + d.toString('utf8')).split('\n')
    buf[k] = parts.pop() ?? ''
    for (const s of parts) addLine(p.id, live, s, re, dirs)
  }
  child.stdout?.on('data', (d: Buffer) => feed('out', d))
  child.stderr?.on('data', (d: Buffer) => feed('err', d))
  const end = async (code: number | null, error?: string) => {
    if (r.status !== 'running') return
    for (const k of ['out', 'err'] as const) if (buf[k]) addLine(p.id, live, buf[k], re, dirs)
    buf = { out: '', err: '' }
    if (error) addLine(p.id, live, error, NONE, dirs)
    r.endedAt = Date.now()
    r.code = code ?? -1
    r.status = stopping.has(r.id) ? 'stopped' : code === 0 ? 'ok' : 'failed'
    stopping.delete(r.id)
    const secs = ((r.endedAt - r.startedAt) / 1000).toFixed(1)
    addLine(
      p.id,
      live,
      r.status === 'ok'
        ? t('编译成功 · {s} 秒', { s: secs })
        : r.status === 'stopped'
          ? t('已停止 · {s} 秒', { s: secs })
          : t('编译失败 · 退出码 {code} · {s} 秒', { code: r.code, s: secs }),
      NONE,
      dirs,
    )
    await afterBuild(ctx, live, mtimes, reloadFiles, dirs).catch((e: Error) =>
      addLine(p.id, live, e.message, NONE, dirs),
    )
    live.log?.end()
    push(p.id, live, true)
    finish()
    void pruneLogs(dir)
  }
  child.on('error', (e) => void end(-1, e.message))
  child.on('close', (code) => void end(code))
  push(p.id, live)
  return r
}

/** 记下这次编成功的基准，按设置自动重载编过的模块 */
async function afterBuild(ctx: OpCtx, live: Live, mtimes: Map<string, number>, reloadFiles: string[], dirs: ErrorDirs) {
  const r = live.run
  const p = ctx.project
  if (r.status === 'stopped') return
  const ms = (r.endedAt ?? Date.now()) - r.startedAt
  await patchBuildState(p.id, (s) => {
    s.last[r.mode] = { at: r.startedAt, ms, files: r.fileCount, ok: r.status === 'ok' }
    if (r.status !== 'ok') return
    s.firstOkAt ??= r.startedAt
    if (r.mode === 'full') {
      s.fullOkAt = r.startedAt
      s.built = {}
    } else for (const f of r.files) s.built[f] = mtimes.get(f) ?? r.startedAt
  })
  if (r.status !== 'ok' || !luaBuildConfig(p).autoReload || !reloadFiles.length) return
  // 按需加载：重载要经 ops.ts 连桥接，那边牵着面板开放的模块，编译本身（和单测）用不到
  const { reloadModules } = await import('./reload.ts')
  r.reload = await reloadModules(ctx, reloadFiles.map(moduleName))
  addLine(p.id, live, r.reload.message, NONE, dirs)
}

const stopping = new Set<string>()

/** 停止正在跑的编译：Windows 用 taskkill /T 连子进程一起结束（.bat 里起的 luac 是孙进程） */
export async function stopLuaBuild(projectId: string) {
  const l = lives.get(projectId)
  if (!l || l.run.status !== 'running' || !l.child?.pid) throw new Error(t('没有正在跑的 Lua 编译'))
  stopping.add(l.run.id)
  if (process.platform === 'win32') {
    const r = await run('taskkill.exe', ['/PID', String(l.child.pid), '/T', '/F'], { timeout: 15000 })
    if (r.code !== 0) throw new Error(t('没能结束编译进程：{msg}', { msg: (r.err || r.out).trim() }))
  } else {
    try {
      process.kill(-l.child.pid, 'SIGTERM')
    } catch {
      l.child.kill('SIGTERM')
    }
  }
  return { ok: true }
}

/** 等这次编译结束，最多等 ms 毫秒；返回时还在跑就是 running */
export async function waitBuild(projectId: string, id: string, ms: number) {
  const l = buildRun(projectId, id)
  if (!l) return undefined
  await Promise.race([l.done, new Promise((res) => setTimeout(res, ms))])
  return l.run
}

async function pruneLogs(dir: string) {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /\.(log|files\.txt)$/.test(n)).sort()
  const ids = [...new Set(names.map((n) => n.split('.')[0]))]
  for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_LOGS)))
    for (const n of names.filter((x) => x.startsWith(`${id}.`))) await rm(path.join(dir, n), { force: true })
}
