import path from 'node:path'
import { pageSubs } from '../page-subs/index.ts'
import { getProject } from '../registry.ts'

/**
 * 日志页的推送（可统一能力盘点第 9 项）：以前日志页每秒问一次服务端（开着 UE 时再问一次桥接），没新日志也照问。
 * 现在页面登记后服务端盯 Saved/Logs 目录（编辑器开着时也一直往这里写），有写入就推 ue-log，页面收到再按游标取新的；
 * 一秒最多推一次（编译着色器时日志一秒写几十次）。
 */
export const LOG_EVENT = 'ue-log'
const GAP_MS = 1000

interface Watch {
  stop?: () => void
  timer?: ReturnType<typeof setTimeout>
  last: number
}

const watches = new Map<string, Watch>() // 模块状态：运行时，页面重连后重新登记

const subs = pageSubs((id) => {
  const w = watches.get(id)
  watches.delete(id)
  if (w?.timer) clearTimeout(w.timer)
  w?.stop?.()
})

function nudge(id: string) {
  const w = watches.get(id)
  if (!w || w.timer) return
  const wait = Math.max(0, w.last + GAP_MS - Date.now())
  w.timer = setTimeout(() => {
    w.timer = undefined
    w.last = Date.now()
    subs.push(LOG_EVENT, id, { project: id })
  }, wait)
}

async function start(id: string, w: Watch) {
  const p = await getProject(id)
  if (!p) return
  try {
    const { watchDir } = await import('@panel/server/watch/dir')
    // 目录还没有（项目没跑过）时盯 Saved：日志目录建出来也算一次变化
    const fw =
      watchDir(path.join(p.root, 'Saved', 'Logs'), () => nudge(id)) ??
      watchDir(path.join(p.root, 'Saved'), (f) => f?.startsWith('Logs') !== false && nudge(id))
    if (watches.get(id) !== w) fw?.close()
    else w.stop = () => fw?.close()
  } catch {
    // 盯不了：页面打开、筛选变化、手动刷新时照样取
  }
}

/** 页面登记 / 取消（on=false） */
export function watchLogs(projectId: string, conn: string, on: boolean) {
  if (!on) {
    subs.remove(projectId, conn)
    return { watching: false }
  }
  const r = subs.add(projectId, conn)
  if (!r.ok) return { watching: false }
  if (r.first) {
    const w: Watch = { last: 0 }
    watches.set(projectId, w)
    void start(projectId, w)
  }
  return { watching: true }
}

/** 插件停掉时 */
export function stopLogFeeds() {
  subs.clear()
}
