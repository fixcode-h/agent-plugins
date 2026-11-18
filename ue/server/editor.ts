import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { liveCards, type Card } from './instances.ts'
import { backgroundExitWhy, editorStartingWhy } from './launch/bg-guard.ts'
import { watchForeground } from './launch/fg-watch.ts'
import { childSource, trackLaunch } from './launch/track.ts'
import { startViaVs, vsLaunchable } from './launch/via-vs.ts'
import { runningJob } from './jobs.ts'
import type { UeProject } from './types.ts'
import { alive, c, exists, t } from './util.ts'

/**
 * 编辑器进程：后台编辑器（设计文档 3.4，-run=AgentPanel，常驻、闲置自己退出）和普通编辑器的启动。
 * 后台编辑器是面板起的子进程；面板退出时不跟着杀（它闲置到时间会自己退），插件关掉时才主动停。
 */
interface Bg {
  child?: ChildProcess
  starting?: Promise<Card>
  error?: string
  /** 因为前台编辑器起来而关掉的：启动中的那次不记成后台编辑器的错误 */
  closedFor?: string
}
const bgs = new Map<string, Bg>()

function exe(p: UeProject, cmd: boolean) {
  const bin = path.join(p.engine.dir, 'Engine', 'Binaries')
  if (process.platform === 'win32') return path.join(bin, 'Win64', cmd ? 'UnrealEditor-Cmd.exe' : 'UnrealEditor.exe')
  if (process.platform === 'darwin')
    return path.join(bin, 'Mac', 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor')
  return path.join(bin, 'Linux', 'UnrealEditor')
}

/**
 * 编辑器没开时读资源要不要自动起后台编辑器：默认不自动起（用户 2026-11-16「后台编辑器默认不启动」），
 * 只在用户在 UE 页点启动、或 Agent 调 ue_editor background_start 时起；插件参数里改成自动才自动起
 */
export const autoBackground = () => c().config().offline === 'background'

/** 没有后台编辑器又不自动起时的报错：说清楚怎么读 */
export const noBackgroundMsg = () =>
  t(
    'UE 没在运行，后台编辑器默认不自动启动：先打开编辑器；或在 UE 页目标卡点「启动后台编辑器」、Agent 调 ue_editor action=background_start（插件参数里也能改成自动启动）',
  )

export function backgroundState(p: UeProject, cards: Card[]) {
  const card = cards.find((x) => x.kind === 'background')
  const bg = bgs.get(p.id)
  // 后台编辑器在跑（也可能是面板上次运行时起的）：盯着前台，前台一起来就关掉它
  if (card) watchForeground(p, (why) => closeBackground(p, why))
  // 编辑器连上以后读写都走它，上一次起后台编辑器的报错已经没意义，清掉（不然左栏一直挂着一条红字）
  if (bg?.error && cards.some((x) => x.kind === 'editor')) bg.error = undefined
  return {
    running: !!card,
    starting: !!bg?.starting,
    pid: card?.pid,
    error: bg?.error,
    auto: autoBackground(),
  }
}

/** 等名片出现：首次启动要加载引擎和扫资源，30–60 秒常见，大项目更久 */
async function waitCard(p: UeProject, kind: string, ms: number, child?: ChildProcess) {
  const root = p.root
  const begin = Date.now()
  const end = begin + ms
  let exited: number | null = null
  child?.once('exit', (code) => (exited = code ?? -1))
  while (Date.now() < end) {
    const card = (await liveCards(root)).find((x) => x.kind === kind)
    if (card) return card
    if (exited !== null) {
      const why = await backgroundExitWhy(p, begin)
      throw new Error(
        why
          ? t('后台编辑器启动后退出了（退出码 {code}）：{why}', { code: exited, why })
          : t('后台编辑器启动后退出了（退出码 {code}），看 Saved/Logs 里的日志', { code: exited }),
      )
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(t('等了 {s} 秒后台编辑器还没就绪', { s: Math.round(ms / 1000) }))
}

/** 起后台编辑器（已经在跑就直接用）；编辑器开着时不起，免得两个进程抢同一个资源文件 */
export async function ensureBackground(p: UeProject): Promise<Card> {
  const cards = await liveCards(p.root)
  const have = cards.find((x) => x.kind === 'background')
  if (have) return have
  if (cards.some((x) => x.kind === 'editor')) throw new Error(t('编辑器开着，读写走编辑器，不起后台编辑器'))
  const bg = bgs.get(p.id) ?? {}
  bgs.set(p.id, bg)
  if (bg.starting) return bg.starting
  // 编辑器正在启动、或开着还没连上：不起第二个进程抢同一个项目，报一句等它就绪（不记成后台编辑器的错误）
  const busy = await editorStartingWhy(p)
  if (busy) throw new Error(busy)
  // 正在编译：后台编辑器会加载项目模块的 DLL，链接写不进去（用户 2026-11-16「编译的时候后台编辑器关掉」）
  if (runningJob(p.id, 'build')) throw new Error(t('正在编译项目：编完再起后台编辑器'))
  if (bg.starting) return bg.starting
  const file = exe(p, true)
  if (!exists(file)) {
    bg.error = t('没找到 {f}：确认引擎目录，或在「权限与设置」里指定', { f: file })
    throw new Error(bg.error)
  }
  const idle = Number(c().config().idleMinutes) || 10
  bg.error = undefined
  bg.closedFor = undefined
  bg.starting = (async () => {
    const child = spawn(
      file,
      [p.uproject, '-run=AgentPanel', '-nullrhi', '-unattended', '-nosplash', '-nosound', `-AgentPanelIdle=${idle}`],
      { cwd: p.root, windowsHide: true, stdio: 'ignore', detached: false },
    )
    bg.child = child
    child.on('exit', () => {
      if (bg.child === child) bg.child = undefined
    })
    try {
      const card = await waitCard(p, 'background', 10 * 60 * 1000, child)
      watchForeground(p, (why) => closeBackground(p, why))
      return card
    } catch (e) {
      child.kill()
      // 是前台编辑器起来、面板主动关的：不算出错，告诉调用方读写改走前台编辑器
      if (bg.closedFor) throw new Error(t('前台编辑器启动了，后台编辑器已关掉：等编辑器加载完，读写走编辑器'))
      bg.error = (e as Error).message
      throw e
    } finally {
      bg.starting = undefined
    }
  })()
  return bg.starting
}

export function stopBackground(id: string) {
  const bg = bgs.get(id)
  bg?.child?.kill()
  if (bg) bg.child = undefined
}

/**
 * 前台编辑器要起来了：关掉后台编辑器（启动中的那次也取消），同时只开一个编辑器（用户 2026-11-16）。
 * 面板上次运行时起的后台编辑器不是这次的子进程，按名片上的 PID 结束。等它真退出（最多 15 秒）再返回，
 * 免得前台编辑器打开项目时后台还占着资源文件和模块 DLL
 */
export async function closeBackground(p: UeProject, why: string) {
  const bg = bgs.get(p.id)
  const pids = new Set<number>()
  if (bg?.child?.pid) pids.add(bg.child.pid)
  for (const x of await liveCards(p.root)) if (x.kind === 'background') pids.add(x.pid)
  if (!pids.size && !bg?.starting) return
  if (bg) {
    bg.closedFor = why
    bg.error = undefined
    bg.child?.kill()
    bg.child = undefined
  }
  for (const pid of pids) {
    try {
      process.kill(pid)
    } catch {
      // 已经退出了
    }
  }
  const until = Date.now() + 15000
  while ([...pids].some(alive) && Date.now() < until) await new Promise((r) => setTimeout(r, 300))
}

export function stopAllBackground() {
  for (const id of bgs.keys()) stopBackground(id)
}

/**
 * 启动编辑器（不等它就绪：编辑器加载完桥接自己写名片；这期间读日志把启动进度推给网页，见 launch/track.ts）。
 * VS 开着这个项目的解决方案时优先经 VS 按 F5 启动（带调试器，用户 2026-11-18，launch/via-vs.ts），不然直接起 UnrealEditor
 */
export async function launchEditor(p: UeProject) {
  const file = exe(p, false)
  if (!exists(file)) throw new Error(t('没找到 {f}：确认引擎目录，或在「权限与设置」里指定', { f: file }))
  // 编辑器还活着（哪怕正卡在加载里不回应）就不再起一个：两个编辑器开同一个项目会抢资源文件（用户 2026-11-16）
  const running = (await liveCards(p.root)).find((x) => x.kind === 'editor')
  if (running)
    throw new Error(
      t('这个项目的编辑器已经开着（PID {pid}）：它在忙时会暂时不回应，等它忙完自动连上，不用再启动一个', {
        pid: running.pid,
      }),
    )
  const vs = await vsLaunchable(p)
  // 同时只开一个编辑器：先关后台编辑器再起前台（用户 2026-11-16）；经 VS 启动也一样，后台编辑器占着模块 DLL 时 F5 前的编译链接不上
  await closeBackground(p, 'launch')
  if (vs) return trackLaunch(p, await startViaVs(p, vs))
  const child = spawn(file, [p.uproject], { cwd: p.root, detached: true, stdio: 'ignore' })
  child.unref()
  return trackLaunch(p, childSource(child))
}
