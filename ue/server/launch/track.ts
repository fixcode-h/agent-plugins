import type { ChildProcess } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { cardReady, liveCards } from '../instances.ts'
import { logFile } from '../logs.ts'
import type { LaunchProgress, UeProject } from '../types.ts'
import { c, readJson, t, writeJson } from '../util.ts'
import { STAGES, estimate, scanLines, type LogScan } from './stages.ts'

/**
 * 面板点「启动编辑器」之后跟着启动进度：每秒读一次项目日志新增的部分认阶段（stages.ts），
 * 编辑器的 UELink 写出名片、并且名片说编辑器已就绪（UELink 2.7 的 ready；旧 UELink 没有这个字段，名片出现就算）才算完成，
 * 进程中途退出算失败。进程活着就不判失败：启动时卡在加载、编着色器里一会儿很常见（用户 2026-11-17）。
 * 进度用插件推送通道推给网页（事件 ue-launch），网页不用轮询；刷新页面时从项目状态里取当前这一份。
 */
export const LAUNCH_EVENT = 'ue-launch'

interface Track {
  p: UeProject
  progress: LaunchProgress
  scan: LogScan
  /** 读到日志的哪个字节；换了新日志文件（编辑器启动时把旧日志改名备份）就从 0 读 */
  offset: number
  /** 启动前的旧日志（大小、修改时间）：还是它就说明新日志没建出来，不读 */
  old?: { size: number; mtime: number }
  exited?: number
  timer?: ReturnType<typeof setTimeout>
  /** 引擎初始化完了的时刻：之后久等不到名片，多半是 UELink 没加载 */
  engineDoneAt?: number
  src: LaunchSource
  /** 估算百分比、记启动用时从哪一刻算：经 VS 启动时是 VS 编完的那一刻，编译多久不算进编辑器的启动用时 */
  t0: number
}

/** 启动进程的一方每秒报的状态（经 VS 启动时由 via-vs.ts 问 VS 得来） */
export interface LaunchPoll {
  /** VS 还在编译 */
  building?: boolean
  /** 编辑器进程起来了 */
  pid?: number
  /** VS 一时没回应 */
  waiting?: 'vs'
  /** 没起来：原样报给用户 */
  failed?: string
}

/**
 * 编辑器是谁起的：面板自己起的子进程（pid + 退出事件），或经 VS 启动（via-vs.ts，每秒问一次 VS）。
 * 进度、阶段、完成判断两边共用这一份
 */
export interface LaunchSource {
  pid?: number
  via?: 'vs'
  onExit?: (cb: (code: number) => void) => void
  poll?: () => Promise<LaunchPoll>
}

const tracks = new Map<string, Track>()
/** 完成 / 失败后在项目状态里留一会儿，刚刷新的页面也看得到结果 */
const KEEP_MS = 8000
/** 进程活着但这么久还没就绪就不再跟进度（只是不跟了，不算失败：大项目首次编着色器可能要很久） */
const TIMEOUT_MS = 60 * 60 * 1000
/** 引擎初始化完了还等不到名片多久，就提示 UELink 没连上 */
const NO_LINK_MS = 90 * 1000

const timesFile = () => path.join(c().dataDir, 'launch-times.json')

async function expectedMs(id: string) {
  const all = await readJson<Record<string, number>>(timesFile(), {})
  return all[id] || 90 * 1000
}

async function saveTime(id: string, ms: number) {
  const all = await readJson<Record<string, number>>(timesFile(), {})
  // 和上次取平均：偶尔一次着色器全量编译不至于把下一次的估算拉得太长
  all[id] = all[id] ? Math.round((all[id] + ms) / 2) : ms
  await writeJson(timesFile(), all)
}

export function launchProgress(id: string): LaunchProgress | undefined {
  return tracks.get(id)?.progress
}

function push(tr: Track) {
  c().pages.push(LAUNCH_EVENT, { project: tr.p.id, ...tr.progress })
}

/** 读日志新增的部分（一次最多 4 MB，着色器编译时日志涨得快，下一秒接着读） */
async function readNew(tr: Track) {
  const file = logFile(tr.p)
  const st = await stat(file).catch(() => null)
  if (!st) return
  if (tr.old && st.size >= tr.old.size && st.mtimeMs === tr.old.mtime) return
  if (tr.old || st.size < tr.offset) {
    tr.old = undefined
    tr.offset = 0
  }
  if (st.size <= tr.offset) return
  const len = Math.min(st.size - tr.offset, 4 * 1024 * 1024)
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, tr.offset)
    // 只处理到最后一个换行，半行留到下次
    const text = buf.toString('utf8')
    const cut = text.lastIndexOf('\n')
    if (cut < 0 && len < 4 * 1024 * 1024) return
    const done = cut < 0 ? text : text.slice(0, cut + 1)
    tr.offset += Buffer.byteLength(done)
    scanLines(tr.scan, done)
  } finally {
    await fh.close()
  }
}

function finish(tr: Track, status: LaunchProgress['status'], error?: string) {
  clearTimeout(tr.timer)
  tr.progress = { ...tr.progress, status, error, percent: status === 'ready' ? 100 : tr.progress.percent }
  push(tr)
  setTimeout(() => {
    if (tracks.get(tr.p.id) === tr) tracks.delete(tr.p.id)
  }, KEEP_MS)
}

/** 问一次启动方（经 VS 启动时）：返回 true 表示这一秒已经处理完（还在编译、失败了） */
async function pollSource(tr: Track): Promise<boolean> {
  if (!tr.src.poll) return false
  const s = await tr.src.poll()
  if (s.failed) {
    finish(tr, 'failed', s.failed)
    return true
  }
  if (s.pid) tr.progress = { ...tr.progress, pid: s.pid }
  if (s.building) {
    tr.t0 = Date.now()
    tr.progress = { ...tr.progress, stage: 'build', percent: 0, waiting: undefined }
    push(tr)
    tr.timer = setTimeout(() => void tick(tr), 1000)
    return true
  }
  tr.progress = { ...tr.progress, waiting: s.waiting }
  return false
}

async function tick(tr: Track) {
  if (tracks.get(tr.p.id) !== tr) return
  if (await pollSource(tr)) return
  const elapsed = Date.now() - tr.t0
  const card = (await liveCards(tr.p.root)).find(
    (x) =>
      x.kind === 'editor' &&
      ((!!tr.progress.pid && x.pid === tr.progress.pid) || Date.parse(x.startedAt) >= tr.progress.startedAt - 5000),
  )
  if (card && cardReady(card)) {
    await saveTime(tr.p.id, elapsed).catch(() => undefined)
    return finish(tr, 'ready')
  }
  await readNew(tr).catch(() => undefined)
  if (tr.exited !== undefined)
    return finish(tr, 'failed', t('编辑器启动后退出了（退出码 {code}），看 Saved/Logs 里的日志', { code: tr.exited }))
  if (Date.now() - tr.progress.startedAt > TIMEOUT_MS)
    return finish(tr, 'failed', t('等了 60 分钟编辑器还没就绪，不再跟进度'))
  const { scan } = tr
  // 名片出来了（UELink 连上）但编辑器还没就绪：至少走到最后一段，也不再提示 UELink 没连上
  if (card)
    scan.stage = Math.max(
      scan.stage,
      STAGES.findIndex((s) => s.id === 'final'),
    )
  if (scan.stage >= STAGES.findIndex((s) => s.id === 'engine')) tr.engineDoneAt ??= Date.now()
  tr.progress = {
    ...tr.progress,
    stage: STAGES[scan.stage].id,
    percent: Math.max(tr.progress.percent, estimate(scan, elapsed, tr.progress.expectedMs)),
    shadersLeft: scan.shadersLeft || undefined,
    shadersMax: scan.shadersMax || undefined,
    waiting:
      tr.progress.waiting === 'vs'
        ? 'vs'
        : scan.rebuildAt !== undefined
          ? 'rebuild'
          : !card && tr.engineDoneAt && Date.now() - tr.engineDoneAt > NO_LINK_MS
            ? 'link'
            : undefined,
  }
  push(tr)
  tr.timer = setTimeout(() => void tick(tr), 1000)
}

/** 面板自己起的子进程当启动方 */
export const childSource = (child: ChildProcess): LaunchSource => ({
  pid: child.pid,
  onExit: (cb) => child.once('exit', (code) => cb(code ?? -1)),
})

/** 开始跟一次启动（同一项目重复点启动时换成新的这一份） */
export async function trackLaunch(p: UeProject, src: LaunchSource) {
  const prev = tracks.get(p.id)
  if (prev) clearTimeout(prev.timer)
  const st = await stat(logFile(p)).catch(() => null)
  const tr: Track = {
    p,
    scan: { stage: 0 },
    offset: 0,
    src,
    t0: Date.now(),
    old: st ? { size: st.size, mtime: st.mtimeMs } : undefined,
    progress: {
      pid: src.pid ?? 0,
      startedAt: Date.now(),
      expectedMs: await expectedMs(p.id),
      stage: src.via === 'vs' ? 'vs' : 'spawn',
      ...(src.via && { via: src.via }),
      percent: 0,
      status: 'running',
    },
  }
  src.onExit?.((code) => (tr.exited = code))
  tracks.set(p.id, tr)
  push(tr)
  tr.timer = setTimeout(() => void tick(tr), 1000)
  return tr.progress
}

export function stopAllLaunchTracks() {
  for (const tr of tracks.values()) clearTimeout(tr.timer)
  tracks.clear()
}
