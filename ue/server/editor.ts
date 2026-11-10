import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { liveCards, type Card } from './instances.ts'
import type { UeProject } from './types.ts'
import { c, exists, t } from './util.ts'

/**
 * 编辑器进程：后台编辑器（设计文档 3.4，-run=AgentPanel，常驻、闲置自己退出）和普通编辑器的启动。
 * 后台编辑器是面板起的子进程；面板退出时不跟着杀（它闲置到时间会自己退），插件关掉时才主动停。
 */
interface Bg {
  child?: ChildProcess
  starting?: Promise<Card>
  error?: string
}
const bgs = new Map<string, Bg>()

function exe(p: UeProject, cmd: boolean) {
  const bin = path.join(p.engine.dir, 'Engine', 'Binaries')
  if (process.platform === 'win32') return path.join(bin, 'Win64', cmd ? 'UnrealEditor-Cmd.exe' : 'UnrealEditor.exe')
  if (process.platform === 'darwin')
    return path.join(bin, 'Mac', 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor')
  return path.join(bin, 'Linux', 'UnrealEditor')
}

export function backgroundState(id: string, cards: Card[]) {
  const card = cards.find((x) => x.kind === 'background')
  const bg = bgs.get(id)
  return { running: !!card, starting: !!bg?.starting, pid: card?.pid, error: bg?.error }
}

/** 等名片出现：首次启动要加载引擎和扫资源，30–60 秒常见，大项目更久 */
async function waitCard(root: string, kind: string, ms: number, child?: ChildProcess) {
  const end = Date.now() + ms
  let exited: number | null = null
  child?.once('exit', (code) => (exited = code ?? -1))
  while (Date.now() < end) {
    const card = (await liveCards(root)).find((x) => x.kind === kind)
    if (card) return card
    if (exited !== null)
      throw new Error(t('后台编辑器启动后退出了（退出码 {code}），看 Saved/Logs 里的日志', { code: exited }))
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
  const file = exe(p, true)
  if (!exists(file)) {
    bg.error = t('没找到 {f}：确认引擎目录，或在「桥接与权限」里指定', { f: file })
    throw new Error(bg.error)
  }
  const idle = Number(c().config().idleMinutes) || 10
  bg.error = undefined
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
      return await waitCard(p.root, 'background', 10 * 60 * 1000, child)
    } catch (e) {
      bg.error = (e as Error).message
      child.kill()
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

export function stopAllBackground() {
  for (const id of bgs.keys()) stopBackground(id)
}

/** 启动编辑器（不等它就绪：编辑器加载完桥接自己写名片，网页轮询会看到） */
export function launchEditor(p: UeProject) {
  const file = exe(p, false)
  if (!exists(file)) throw new Error(t('没找到 {f}：确认引擎目录，或在「桥接与权限」里指定', { f: file }))
  const child = spawn(file, [p.uproject], { cwd: p.root, detached: true, stdio: 'ignore' })
  child.unref()
  return child.pid
}
