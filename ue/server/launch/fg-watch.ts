import { liveCards } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { editorStartingWhy } from './bg-guard.ts'

/**
 * 后台编辑器在跑时盯着前台（用户 2026-11-16：「启动前台编辑器，后台编辑器就关了吧，同时只存在一个」）。
 * 面板自己点的启动、经 UEToVS 的 start / restart 在启动前就关掉了；这里兜住面板跟不到的：
 * 用户双击 .uproject、在 VS 里自己按 F5、从启动器打开。看到前台起来就关后台，后台没了就停。
 * 只在服务端跑、只在有后台编辑器时跑（它闲置会自己退），不是给网页轮询
 */
interface Watch {
  timer: ReturnType<typeof setTimeout>
  n: number
}
const watches = new Map<string, Watch>()

const TICK_MS = 3000
/** 查进程要起 PowerShell（一次一两秒），隔几轮查一次；编辑器名片、VS 状态都便宜，每轮查 */
const PROC_EVERY = 5

export function watchForeground(p: UeProject, close: (why: string) => Promise<void>) {
  if (watches.has(p.id)) return
  const w: Watch = { n: 0, timer: setTimeout(() => void tick(), TICK_MS) }
  watches.set(p.id, w)
  async function tick() {
    let done = false
    try {
      const cards = await liveCards(p.root)
      const bg = cards.find((x) => x.kind === 'background')
      if (!bg) done = true
      else {
        const editor = cards.find((x) => x.kind === 'editor')
        const why = editor
          ? `editor ${editor.pid}`
          : await editorStartingWhy(p, { procs: w.n % PROC_EVERY === 0, bgPid: bg.pid })
        if (why) {
          await close(why)
          done = true
        }
      }
    } catch {
      // 读名片、问 VS 偶尔失败不影响下一轮
    }
    w.n++
    if (done || watches.get(p.id) !== w) {
      if (watches.get(p.id) === w) watches.delete(p.id)
      return
    }
    w.timer = setTimeout(() => void tick(), TICK_MS)
  }
}

export function stopAllForegroundWatches() {
  for (const w of watches.values()) clearTimeout(w.timer)
  watches.clear()
}
