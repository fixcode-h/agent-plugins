import path from 'node:path'
import { projectState } from '../actions.ts'
import { getProject } from '../registry.ts'
import type { ProjectState, UeProject } from '../types.ts'
import { c } from '../util.ts'

/**
 * UE 页的项目概况（实例、桥接、扩展、启动进度……）改成服务端推送（统一能力盘点第 4 项）：
 * 以前 UE 页 3 秒、资源查看页和对话侧栏 5 秒各自整份取 state，开几个标签页就是几倍的 /info 探测和读盘，
 * UE 停在断点时所有页面一起慢。现在每个项目只有一份：有页面登记时服务端算，变了才推 ue-state 给登记了的页面。
 *
 * - 页面按推送连接登记（网页 host.events 的连接 id），断线面板回调 onClose，一起清掉；没人看的项目不算。
 * - 名片目录有变化（UE 启动、退出）马上重算；其余（忙不忙、在哪个世界、编译作业）每 TICK_MS 算一次，
 *   上一次还没算完（UE 卡在长帧里，/info 要等超时）就跳过这一拍，不堆请求。
 * - 别的动作改了概况（装桥接、改设置、启动）调 kickState 马上重算。
 */
export const STATE_EVENT = 'ue-state'
const TICK_MS = 3000

interface Feed {
  conns: Set<string>
  timer?: ReturnType<typeof setInterval>
  last?: string
  running?: boolean
  again?: boolean
  stopWatch?: () => void
}

const feeds = new Map<string, Feed>() // 模块状态：运行时，页面重连后重新登记
let closeHooked = false

async function compute(id: string) {
  const f = feeds.get(id)
  if (!f) return
  if (f.running) {
    f.again = true
    return
  }
  f.running = true
  try {
    const p = await getProject(id)
    if (!p) return
    const state = await projectState(p)
    const sig = JSON.stringify(state)
    if (sig === f.last || feeds.get(id) !== f || !f.conns.size) return
    f.last = sig
    c().pages.push(STATE_EVENT, { project: id, state } satisfies { project: string; state: ProjectState }, [...f.conns])
  } catch {
    // 算不出来（项目刚删、读盘失败）：下一拍再算，页面上保留上一份
  } finally {
    f.running = false
    if (f.again) {
      f.again = false
      void compute(id)
    }
  }
}

async function watchCards(p: UeProject, f: Feed) {
  try {
    const { watchDir } = await import('@panel/server/watch/dir')
    const stops = ['UELink', 'AgentPanel']
      .map((d) => watchDir(path.join(p.root, 'Saved', d, 'instances'), () => void compute(p.id)))
      .filter((w) => !!w)
    if (feeds.get(p.id) !== f) for (const w of stops) w.close()
    else f.stopWatch = () => stops.forEach((w) => w.close())
  } catch {
    // 盯不了（目录还没有）：靠定时那一拍
  }
}

function stop(id: string) {
  const f = feeds.get(id)
  if (!f) return
  feeds.delete(id)
  if (f.timer) clearInterval(f.timer)
  f.stopWatch?.()
}

function forget(conn: string) {
  for (const [id, f] of [...feeds]) {
    f.conns.delete(conn)
    if (!f.conns.size) stop(id)
  }
}

/** 页面登记 / 取消：on=false 取消。登记后马上推一份（页面不用另取） */
export async function watchState(p: UeProject, conn: string, on: boolean) {
  if (!conn || !c().pages.open(conn)) return { watching: false }
  if (!closeHooked) {
    closeHooked = true
    c().pages.onClose(forget)
  }
  let f = feeds.get(p.id)
  if (!on) {
    f?.conns.delete(conn)
    if (f && !f.conns.size) stop(p.id)
    return { watching: false }
  }
  if (!f) {
    f = { conns: new Set() }
    feeds.set(p.id, f)
    f.timer = setInterval(() => void compute(p.id), TICK_MS)
    f.timer.unref?.()
    void watchCards(p, f)
  }
  f.conns.add(conn)
  // 新来的页面也要拿到一份：清掉上次的签名，这一次照推
  f.last = undefined
  void compute(p.id)
  return { watching: true }
}

/** 别的动作改了概况（装桥接、改设置、启动、关编辑器）：有人在看就马上重算 */
export function kickState(projectId: string) {
  if (feeds.has(projectId)) void compute(projectId)
}

/** 插件停掉时 */
export function stopStateFeeds() {
  for (const id of [...feeds.keys()]) stop(id)
}
