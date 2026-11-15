import type { ChildProcess } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { liveCards } from '../instances.ts'
import { logFile } from '../logs.ts'
import type { LaunchProgress, UeProject } from '../types.ts'
import { c, readJson, t, writeJson } from '../util.ts'
import { STAGES, estimate, scanLines, type LogScan } from './stages.ts'

/**
 * 面板点「启动编辑器」之后跟着启动进度：每秒读一次项目日志新增的部分认阶段（stages.ts），
 * 编辑器的 UELink 写出名片（连上了）就算完成，进程中途退出算失败。
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
}

const tracks = new Map<string, Track>()
/** 完成 / 失败后在项目状态里留一会儿，刚刷新的页面也看得到结果 */
const KEEP_MS = 8000
const TIMEOUT_MS = 20 * 60 * 1000
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

async function tick(tr: Track) {
  if (tracks.get(tr.p.id) !== tr) return
  const elapsed = Date.now() - tr.progress.startedAt
  const card = (await liveCards(tr.p.root)).find(
    (x) =>
      x.kind === 'editor' && (x.pid === tr.progress.pid || Date.parse(x.startedAt) >= tr.progress.startedAt - 5000),
  )
  if (card) {
    await saveTime(tr.p.id, elapsed).catch(() => undefined)
    return finish(tr, 'ready')
  }
  await readNew(tr).catch(() => undefined)
  if (tr.exited !== undefined)
    return finish(tr, 'failed', t('编辑器启动后退出了（退出码 {code}），看 Saved/Logs 里的日志', { code: tr.exited }))
  if (elapsed > TIMEOUT_MS) return finish(tr, 'failed', t('等了 20 分钟编辑器还没连上，不再跟进度'))
  const { scan } = tr
  if (scan.stage >= STAGES.findIndex((s) => s.id === 'engine')) tr.engineDoneAt ??= Date.now()
  tr.progress = {
    ...tr.progress,
    stage: STAGES[scan.stage].id,
    percent: Math.max(tr.progress.percent, estimate(scan, elapsed, tr.progress.expectedMs)),
    shadersLeft: scan.shadersLeft || undefined,
    shadersMax: scan.shadersMax || undefined,
    waiting:
      scan.rebuildAt !== undefined
        ? 'rebuild'
        : tr.engineDoneAt && Date.now() - tr.engineDoneAt > NO_LINK_MS
          ? 'link'
          : undefined,
  }
  push(tr)
  tr.timer = setTimeout(() => void tick(tr), 1000)
}

/** 开始跟一次启动（同一项目重复点启动时换成新的这一份） */
export async function trackLaunch(p: UeProject, child: ChildProcess) {
  const prev = tracks.get(p.id)
  if (prev) clearTimeout(prev.timer)
  const st = await stat(logFile(p)).catch(() => null)
  const tr: Track = {
    p,
    scan: { stage: 0 },
    offset: 0,
    old: st ? { size: st.size, mtime: st.mtimeMs } : undefined,
    progress: {
      pid: child.pid ?? 0,
      startedAt: Date.now(),
      expectedMs: await expectedMs(p.id),
      stage: 'spawn',
      percent: 0,
      status: 'running',
    },
  }
  child.once('exit', (code) => (tr.exited = code ?? -1))
  tracks.set(p.id, tr)
  push(tr)
  tr.timer = setTimeout(() => void tick(tr), 1000)
  return tr.progress
}

export function stopAllLaunchTracks() {
  for (const tr of tracks.values()) clearTimeout(tr.timer)
  tracks.clear()
}
