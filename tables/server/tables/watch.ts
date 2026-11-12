/**
 * 外部改动检测：盯着页面上打开着的表格文件，被 Excel / WPS、版本控制（更新、切分支、P4 同步）改了就推给页面。
 * 原来是页面每 4 秒请求一次 /stat（轮询），换成 fs.watch 加面板的推送通道（插件接口 7，ctx.pages）。
 *
 * - 盯的是文件所在的目录，不是文件本身：Excel / WPS 保存是先写临时文件再改名替换，盯文件的话改名之后就盯丢了。
 *   一个目录一个 watcher，按文件名分给登记了这个文件的页面。
 * - 事件来了不马上推：保存时会连着来好几下（写临时文件、改名、改属性），等它停 300ms 再看修改时间，
 *   和上次推过的不一样才推，同一次保存只推一次。
 * - 页面按连接登记（网页 host.events.onConnect 给的 id）：连接断了面板回调 onClose，这个页面的登记一起清掉；
 *   没人盯的目录关掉 watcher。
 */
import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { PluginPages } from '../../../sdk/server.ts'

/** 同一时刻最多盯这么多个目录：每个 watcher 占一个系统句柄，开几百个标签页也不能把句柄用光 */
const MAX_DIRS = 256
/** 一个页面最多登记这么多个文件 */
const MAX_PER_CONN = 200
/** 保存时连着来的事件等它停这么久再看 */
const SETTLE_MS = 300

export interface FileChanged {
  projectId: string
  /** 页面登记时用的路径（相对表格目录或项目的写法，页面按它找打开的文档） */
  path: string
  mtime?: string
  /** 文件被删了或改名走了 */
  missing?: boolean
}

interface Sub {
  conn: string
  projectId: string
  rel: string
}

interface DirWatch {
  watcher: FSWatcher
  /** 文件名 → 盯着它的完整路径（不同大小写写法在 Windows 上是同一个文件，按名字分） */
  files: Map<string, Set<string>>
}

interface FileState {
  subs: Map<string, Sub>
  /** 最后一次知道的修改时间：登记时页面给的（打开时的），推过之后换成推的 */
  mtime: string
  timer?: ReturnType<typeof setTimeout>
}

export function tableWatcher(pages: PluginPages | undefined) {
  const dirs = new Map<string, DirWatch>()
  const files = new Map<string, FileState>()
  const byConn = new Map<string, Set<string>>()
  const subKey = (s: Sub) => `${s.conn}\u0000${s.projectId}\u0000${s.rel}`

  const check = async (full: string) => {
    const f = files.get(full)
    if (!f) return
    f.timer = undefined
    const st = await stat(full).catch(() => null)
    const mtime = st?.isFile() ? st.mtime.toISOString() : ''
    if (mtime === f.mtime) return
    f.mtime = mtime
    // 同一个文件可能在几个页面、几个项目里开着：按（项目，路径）分别推给各自的页面
    const groups = new Map<string, { data: FileChanged; to: string[] }>()
    for (const s of f.subs.values()) {
      const k = `${s.projectId}\u0000${s.rel}`
      let g = groups.get(k)
      if (!g)
        groups.set(
          k,
          (g = { data: { projectId: s.projectId, path: s.rel, ...(mtime ? { mtime } : { missing: true }) }, to: [] }),
        )
      g.to.push(s.conn)
    }
    for (const g of groups.values()) pages?.push('file-changed', g.data, g.to)
  }

  const onEvent = (dir: string, name: string | Buffer | null) => {
    const d = dirs.get(dir)
    if (!d) return
    // 有的系统不给文件名（或给的是临时文件名）：目录里盯着的文件都看一遍，修改时间没变的不会推
    const hit = name ? d.files.get(path.basename(String(name)).toLowerCase()) : undefined
    const list = hit ?? new Set([...d.files.values()].flatMap((s) => [...s]))
    for (const full of list) {
      const f = files.get(full)
      if (!f) continue
      if (f.timer) clearTimeout(f.timer)
      f.timer = setTimeout(() => void check(full), SETTLE_MS)
    }
  }

  const openDir = (dir: string) => {
    let d = dirs.get(dir)
    if (d) return d
    if (dirs.size >= MAX_DIRS) return undefined
    let watcher: FSWatcher
    try {
      watcher = watch(dir, { persistent: false }, (_e, name) => onEvent(dir, name))
    } catch {
      // 盯不了（网络盘、权限）：不报错，保存时还有修改时间检查兜底
      return undefined
    }
    watcher.on('error', () => closeDir(dir))
    d = { watcher, files: new Map() }
    dirs.set(dir, d)
    return d
  }

  const closeDir = (dir: string) => {
    const d = dirs.get(dir)
    if (!d) return
    dirs.delete(dir)
    try {
      d.watcher.close()
    } catch {
      // 已经关了
    }
  }

  const drop = (full: string, key: string) => {
    const f = files.get(full)
    if (!f) return
    f.subs.delete(key)
    if (f.subs.size) return
    if (f.timer) clearTimeout(f.timer)
    files.delete(full)
    const dir = path.dirname(full)
    const d = dirs.get(dir)
    const name = path.basename(full).toLowerCase()
    const same = d?.files.get(name)
    same?.delete(full)
    if (same && !same.size) d!.files.delete(name)
    if (d && !d.files.size) closeDir(dir)
  }

  const forget = (conn: string) => {
    const keys = byConn.get(conn)
    if (!keys) return
    byConn.delete(conn)
    for (const k of keys) {
      const [full, key] = k.split('\u0001')
      drop(full, key)
    }
  }
  const offClose = pages?.onClose(forget)

  return {
    /**
     * 页面登记要盯的文件：list 是这个页面在这个项目里现在打开着的全部文件（整份替换，没列的就不盯了）。
     * mtime 是页面打开时的修改时间：登记时已经和它不一样（登记前就被改了）马上推一次
     */
    set(conn: string, projectId: string, list: { full: string; rel: string; mtime: string }[]) {
      if (!pages?.open(conn)) return { watching: 0 }
      const mine = byConn.get(conn) ?? new Set<string>()
      byConn.set(conn, mine)
      const want = new Set<string>()
      let n = 0
      for (const item of list.slice(0, MAX_PER_CONN)) {
        const sub: Sub = { conn, projectId, rel: item.rel }
        const key = subKey(sub)
        want.add(`${item.full}\u0001${key}`)
        let f = files.get(item.full)
        if (!f) {
          const d = openDir(path.dirname(item.full))
          if (!d) continue
          const name = path.basename(item.full).toLowerCase()
          if (!d.files.has(name)) d.files.set(name, new Set())
          d.files.get(name)!.add(item.full)
          files.set(item.full, (f = { subs: new Map(), mtime: item.mtime }))
          // 登记前就改了：马上看一次
          f.timer = setTimeout(() => void check(item.full), 0)
        } else if (!f.subs.has(key) && f.mtime && item.mtime && f.mtime > item.mtime)
          // 别的页面也开着、已经推过新版本（这个页面断线重连、刚打开的是旧内容）：单独补推给这个页面
          pages.push('file-changed', { projectId, path: item.rel, mtime: f.mtime } satisfies FileChanged, conn)
        f.subs.set(key, sub)
        n++
      }
      // 这个项目里不再打开的文件不盯了（别的项目的登记不动）
      for (const k of [...mine]) {
        if (want.has(k)) continue
        const [full, key] = k.split('\u0001')
        if (!key.startsWith(`${conn}\u0000${projectId}\u0000`)) continue
        mine.delete(k)
        drop(full, key)
      }
      for (const k of want) mine.add(k)
      return { watching: n }
    },
    /** 自己刚写过（保存、切版本）：把新的修改时间记下，watcher 看到的这次改动不当成外面改的 */
    saw(full: string, mtime: string) {
      const f = files.get(full)
      if (f) f.mtime = mtime
    },
    /** 插件停掉时：关掉所有 watcher */
    close() {
      offClose?.()
      for (const f of files.values()) if (f.timer) clearTimeout(f.timer)
      files.clear()
      byConn.clear()
      for (const dir of [...dirs.keys()]) closeDir(dir)
    },
    /** 测试用：现在盯着几个目录、几个文件 */
    size: () => ({ dirs: dirs.size, files: files.size }),
  }
}

export type TableWatcher = ReturnType<typeof tableWatcher>
