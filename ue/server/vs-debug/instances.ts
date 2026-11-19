import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readJson } from '../util.ts'
import type { Endpoint } from './protocol.ts'

/**
 * 本机开着的 VS：「用 VS 打开这个项目」要分清 VS 没开、VS 开着别的项目、VS 开着这个项目但调试控制没开三种情况。
 * - UEToVS 0.9.5 起每个开着调试控制的 VS 在 %LOCALAPPDATA%\UEToVS\Debug\instances\<PID>.json 写一份发现文件，
 *   能连上它让它换解决方案（solution.open）
 * - 旧版 UEToVS 或设置里关了调试控制的 VS 没有这份文件，只能从 devenv 的窗口标题（解决方案名）认出来
 */

/** 进程还在不在：signal 0 只检查不发信号；EPERM 说明进程在、只是没权限 */
export function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

let registryDir: string | undefined
/** 单测换成临时目录 */
export function setRegistryDir(dir: string | undefined) {
  registryDir = dir
}
const instancesDir = () =>
  registryDir ??
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'UEToVS', 'Debug', 'instances')

export interface VsInstance {
  pid: number
  endpoint: Endpoint
}

/** 用户目录里登记的、进程还在的 VS（UEToVS 0.9.5 起） */
export async function listVsInstances(): Promise<VsInstance[]> {
  const dir = instancesDir()
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^\d+\.json$/i.test(n))
  const out: VsInstance[] = []
  for (const n of names) {
    const endpoint = await readJson<Endpoint | null>(path.join(dir, n), null)
    if (!endpoint || typeof endpoint.pipe !== 'string' || typeof endpoint.token !== 'string') continue
    const pid = Number(endpoint.pid ?? n.replace(/\.json$/i, ''))
    if (!Number.isFinite(pid) || !pidAlive(pid)) continue
    out.push({ pid, endpoint })
  }
  return out
}

export interface VsWindow {
  pid: number
  title: string
}

/**
 * tasklist /v 的 CSV（不带表头）：映像名、PID、会话名、会话#、内存、状态、用户名、CPU 时间、窗口标题。
 * 列名随系统语言变，所以按位置取：第 2 列 PID、最后一列标题
 */
export function parseTasklist(text: string): VsWindow[] {
  const out: VsWindow[] = []
  for (const line of text.split(/\r?\n/)) {
    const cols = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'))
    if (cols.length < 3 || !/^devenv\.exe$/i.test(cols[0])) continue
    const pid = Number(cols[1])
    const title = cols[cols.length - 1]
    if (Number.isFinite(pid) && title && title !== 'N/A') out.push({ pid, title })
  }
  return out
}

/** 窗口标题是不是这个解决方案：VS 的标题是「<解决方案名> - Microsoft Visual Studio」，可能带「(管理员)」之类的括号 */
export function titleIsSolution(title: string, solution: string) {
  const name = path.basename(solution.replace(/\\/g, '/')).replace(/\.slnx?$/i, '')
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${esc}(\\s*\\([^)]*\\))*\\s+-\\s`, 'i').test(title)
}

/** tasklist /v 要查每个窗口的标题，慢的时候一两秒：缓存 5 秒，同时只跑一个 */
const WINDOW_TTL_MS = 5000
let windows: { at: number; list: VsWindow[] } | undefined
let windowsJob: Promise<VsWindow[]> | undefined

export function devenvWindows(): Promise<VsWindow[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  if (windows && Date.now() - windows.at < WINDOW_TTL_MS) return Promise.resolve(windows.list)
  windowsJob ??= new Promise<VsWindow[]>((resolve) =>
    execFile(
      'tasklist',
      ['/v', '/fi', 'imagename eq devenv.exe', '/fo', 'csv', '/nh'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        const list = err ? [] : parseTasklist(String(stdout))
        windows = { at: Date.now(), list }
        resolve(list)
      },
    ),
  ).finally(() => (windowsJob = undefined))
  return windowsJob
}

const norm = (s: string) => path.resolve(s).replace(/\\/g, '/').toLowerCase()
export const sameFile = (a?: string, b?: string) => !!a && !!b && norm(a) === norm(b)

export interface VsSituation {
  /** 开着别的解决方案、能让它换成这个项目的 VS */
  others: VsInstance[]
  /** 有 VS 开着这个解决方案，但没有调试控制（UEToVS 太旧或设置里关了） */
  openWithoutControl: boolean
}

/** 这个解决方案在本机 VS 里的情况；windowWaitMs 内拿不到窗口标题就当没有（网页状态不能等太久） */
export async function vsSituation(solution: string, windowWaitMs = 5000): Promise<VsSituation> {
  const [insts, wins] = await Promise.all([
    listVsInstances(),
    Promise.race([devenvWindows(), new Promise<VsWindow[]>((r) => setTimeout(() => r([]), windowWaitMs))]),
  ])
  const mine = insts.filter((i) => sameFile(i.endpoint.solution, solution))
  const others = insts.filter((i) => !!i.endpoint.solution && !sameFile(i.endpoint.solution, solution))
  const controlled = new Set(insts.map((i) => i.pid))
  const openWithoutControl =
    !mine.length && wins.some((w) => !controlled.has(w.pid) && titleIsSolution(w.title, solution))
  return { others, openWithoutControl }
}
